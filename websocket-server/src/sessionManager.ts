import { RawData, WebSocket } from "ws";
import functions, { sessionControl } from "./functionHandlers";
import { AzureOpenAIConfig, getAzureRealtimeUrl, getAzureHeaders } from "./azureConfig";
import { traceable, logLangSmithEvent } from "./tracing";
import {
  startConversation,
  endConversation,
  trackUserMessage,
  trackAssistantMessage,
  trackFunctionCall
} from "./conversationTracker";
import { SYSTEM_PROMPT, INITIAL_GREETING, VOICE_CONFIG, CONVERSATION_CONFIG } from "./systemPrompt";
import { recordingManager } from "./recordingManager";
import { startTwilioRecording } from "./twilioRecording";
import { getConsentDenialAudioChunks } from "./prerecordedAudio";

interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  modelConn?: WebSocket;
  streamSid?: string;
  tempSessionId?: string;
  saved_config?: any;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  openAIApiKey?: string;
  azureConfig?: AzureOpenAIConfig;
  audioDurationMs?: number;
  audioChunkCount?: number;
  recordingSid?: string;
  callSid?: string;
}

// CRITICAL FIX: Use a Map to store sessions by streamSid instead of a single global session
const sessions = new Map<string, Session>();

// Helper to get or create session
function getSession(streamSid: string): Session {
  if (!sessions.has(streamSid)) {
    sessions.set(streamSid, {});
  }
  return sessions.get(streamSid)!;
}

// Helper to clean up session
function removeSession(streamSid: string) {
  const session = sessions.get(streamSid);
  if (session) {
    console.log(`🧹 Cleaning up session ${streamSid}`);
    sessions.delete(streamSid);
  }
}

export const handleCallConnection = traceable(
  async function handleCallConnection(
    ws: WebSocket,
    openAIApiKey: string,
    azureConfig?: AzureOpenAIConfig
  ) {
    // Create a temporary session until we get the streamSid
    const tempSessionId = `temp_${Date.now()}_${Math.random()}`;
    let session = getSession(tempSessionId);
    
    // Store the temp session ID in the session object for tracking
    session.tempSessionId = tempSessionId;

    console.log(`📞 New call connection (temp ID: ${tempSessionId})`);

    cleanupConnection(session.twilioConn);
    session.twilioConn = ws;
    session.openAIApiKey = openAIApiKey;
    session.azureConfig = azureConfig;

    // Store the session reference on the WebSocket for message handling
    (ws as any).sessionRef = session;

    ws.on("message", (data) => {
      // Get the current session reference from the WebSocket
      const currentSession = (ws as any).sessionRef as Session;
      const sessionId = currentSession.streamSid || currentSession.tempSessionId || tempSessionId;
      handleTwilioMessage(data, sessionId);
    });
    ws.on("error", ws.close);
    ws.on("close", () => {
      // Find the actual streamSid for this connection
      let actualStreamSid = tempSessionId;

      // Check if this temp session was moved to a real streamSid
      sessions.forEach((sess, sid) => {
        if (sess === session && sid !== tempSessionId) {
          actualStreamSid = sid;
        }
      });

      if (session.streamSid) {
        actualStreamSid = session.streamSid;
      }

      console.log(`📞 Call disconnected (${actualStreamSid})`);

      if (session.streamSid) {
        endConversation(session.streamSid);
        // Only stop local recording if not using Twilio recording
        if (process.env.ENABLE_RECORDING !== "false" && !process.env.PUBLIC_URL) {
          recordingManager.stopRecording(session.streamSid);
        }
      }

      cleanupConnection(session.modelConn);
      cleanupConnection(session.twilioConn);
      removeSession(tempSessionId);
      removeSession(actualStreamSid);
    });
  },
  { name: "handleCallConnection", metadata: { type: "websocket-handler" } }
);

export function handleFrontendConnection(ws: WebSocket, streamSid?: string) {
  if (!streamSid) {
    console.warn("Frontend connection without streamSid");
    ws.close();
    return;
  }

  const session = getSession(streamSid);
  cleanupConnection(session.frontendConn);
  session.frontendConn = ws;

  ws.on("message", (data) => handleFrontendMessage(data, session));
  ws.on("close", () => {
    cleanupConnection(session.frontendConn);
    session.frontendConn = undefined;
    if (!session.twilioConn && !session.modelConn) {
      removeSession(streamSid);
    }
  });
}

const handleFunctionCall = traceable(
  async function handleFunctionCall(item: { name: string; arguments: string }) {
    console.log("Handling function call:", item);
    const fnDef = functions.find((f) => f.schema.name === item.name);
    if (!fnDef) {
      throw new Error(`No handler found for function: ${item.name}`);
    }

    let args: unknown;
    try {
      args = JSON.parse(item.arguments);
    } catch {
      return JSON.stringify({
        error: "Invalid JSON arguments for function call.",
      });
    }

    try {
      console.log("Calling function:", fnDef.schema.name, args);
      const result = await fnDef.handler(args as any);
      return result;
    } catch (err: any) {
      console.error("Error running function:", err);
      return JSON.stringify({
        error: `Error running function ${item.name}: ${err.message}`,
      });
    }
  },
  { name: "handleFunctionCall", metadata: { type: "function-call" } }
);

async function handleTwilioMessage(data: RawData, sessionId: string) {
  const msg = parseMessage(data);
  if (!msg) return;

  // Get the current session
  let session = sessions.get(sessionId);
  if (!session) {
    console.error(`Session ${sessionId} not found!`);
    return;
  }

  // Only log non-media events to reduce noise
  if (msg.event !== "media") {
    console.log("📞 Twilio message:", msg.event);
  }

  switch (msg.event) {
    case "start":
      // Move session from temp ID to real streamSid
      const realStreamSid = msg.start.streamSid;
      const callSid = msg.start.callSid; // Extract callSid

      // Remove from temp ID and add with real streamSid
      sessions.delete(sessionId);
      sessions.set(realStreamSid, session);

      console.log(`🔄 Session moved from ${sessionId} to ${realStreamSid}`);

      session.streamSid = realStreamSid;
      session.callSid = callSid;
      session.latestMediaTimestamp = 0;
      session.lastAssistantItem = undefined;
      session.responseStartTimestamp = undefined;
      session.audioDurationMs = undefined;
      session.audioChunkCount = undefined;

      startConversation(session.streamSid!);

      // Start recording based on ENABLE_RECORDING configuration
      if (process.env.ENABLE_RECORDING !== "false") {
        // Use Twilio recording if PUBLIC_URL is set, otherwise use local recording
        if (process.env.PUBLIC_URL) {
          try {
            const recordingData = await startTwilioRecording({
              callSid: callSid,
              recordingStatusCallback: `${process.env.PUBLIC_URL}/recording-callback`,
              recordingStatusCallbackEvent: ['in-progress', 'completed', 'absent'],
              recordingChannels: 'mono', // Records both sides mixed into one channel
              trim: 'trim-silence'
            });
            
            console.log(`🎙️ Twilio recording started:`, recordingData);
            session.recordingSid = recordingData.sid;
          } catch (error) {
            console.error(`❌ Failed to start Twilio recording:`, error);
          }
        } else {
          // Fall back to local recording
          recordingManager.startRecording(session.streamSid!);
        }
      }

      tryConnectModel(session);
      break;

    case "media":
      session.latestMediaTimestamp = msg.media.timestamp;

      // Only do local recording if not using Twilio recording
      if (process.env.ENABLE_RECORDING !== "false" && !process.env.PUBLIC_URL && session.streamSid && msg.media.payload) {
        const audioBuffer = Buffer.from(msg.media.payload, 'base64');
        recordingManager.writeInboundAudio(session.streamSid, audioBuffer);
      }

      if (isOpen(session.modelConn)) {
        const audioEvent = {
          type: "input_audio_buffer.append",
          audio: msg.media.payload,
        };
        jsonSend(session.modelConn, audioEvent);
      }
      break;

    case "close":
      if (session.streamSid) {
        endConversation(session.streamSid);
        // Only stop local recording if not using Twilio recording
        if (process.env.ENABLE_RECORDING !== "false" && !process.env.PUBLIC_URL) {
          recordingManager.stopRecording(session.streamSid);
        }
      }
      closeAllConnections(session);
      break;
  }
}

function handleFrontendMessage(data: RawData, session: Session) {
  const msg = parseMessage(data);
  if (!msg) return;

  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, msg);
  }

  if (msg.type === "session.update") {
    session.saved_config = msg.session;
  }
}

const tryConnectModel = traceable(
  function tryConnectModel(session: Session) {
    if (!session.twilioConn || !session.streamSid || !session.openAIApiKey)
      return;
    if (isOpen(session.modelConn)) return;

    let wsUrl: string;
    let headers: Record<string, string>;

    if (session.azureConfig?.useAzure) {
      wsUrl = getAzureRealtimeUrl(session.azureConfig);
      headers = getAzureHeaders(session.openAIApiKey);
      console.log(`Connecting to Azure OpenAI for session ${session.streamSid}:`, wsUrl);
    } else {
      wsUrl = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";
      headers = {
        Authorization: `Bearer ${session.openAIApiKey}`,
        "OpenAI-Beta": "realtime=v1",
      };
      console.log(`Connecting to OpenAI for session ${session.streamSid}:`, wsUrl);
    }

    session.modelConn = new WebSocket(wsUrl, { headers });

    session.modelConn.on("open", () => {
      console.log(`✅ WebSocket connected successfully for session ${session.streamSid}`);
      const config = session.saved_config || {};

      const tools = functions.map(f => ({
        type: "function",
        name: f.schema.name,
        description: f.schema.description,
        parameters: f.schema.parameters
      }));

      const sessionConfig = {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          turn_detection: { type: "server_vad" },
          voice: config.voice || VOICE_CONFIG.voice,
          input_audio_transcription: {
            model: CONVERSATION_CONFIG.transcriptionModel
          },
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          instructions: config.instructions || SYSTEM_PROMPT,
          tools: tools,
          ...config,
        },
      };

      console.log("📤 Sending session config:", JSON.stringify(sessionConfig, null, 2));
      jsonSend(session.modelConn, sessionConfig);

      if (INITIAL_GREETING.enabled) {
        setTimeout(() => {
          if (isOpen(session.modelConn)) {
            console.log(`👋 Sending greeting message for session ${session.streamSid}`);
            jsonSend(session.modelConn, {
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "user",
                content: [{
                  type: "input_text",
                  text: INITIAL_GREETING.message
                }]
              }
            });

            jsonSend(session.modelConn, {
              type: "response.create"
            });
          }
        }, INITIAL_GREETING.delayMs);
      }
    });

    session.modelConn.on("message", (data) => handleModelMessage(data, session));
    session.modelConn.on("error", (error) => {
      console.error(`❌ WebSocket error for session ${session.streamSid}:`, error);
      closeModel(session);
    });
    session.modelConn.on("close", (code, reason) => {
      console.log(`🔌 WebSocket closed for session ${session.streamSid}. Code:`, code, "Reason:", reason.toString());
      closeModel(session);
    });
  },
  { name: "tryConnectModel", metadata: { type: "connection" } }
);

const handleModelMessage = traceable(
  function handleModelMessage(data: RawData, session: Session) {
    const event = parseMessage(data);
    if (!event) return;

    console.log(`🤖 Model event [${session.streamSid}]:`, event.type);

    if (event.type === "error") {
      console.error(`❌ Model error [${session.streamSid}]:`, JSON.stringify(event, null, 2));

      if (event.error?.type === "invalid_value" &&
        event.error?.message?.includes("Audio content") &&
        event.error?.message?.includes("shorter than")) {
        console.warn(`⚠️ Truncation timing error detected for session ${session.streamSid}`);

        session.lastAssistantItem = undefined;
        session.responseStartTimestamp = undefined;
        session.audioDurationMs = undefined;
        session.audioChunkCount = undefined;

        if (session.twilioConn && session.streamSid && isOpen(session.twilioConn)) {
          jsonSend(session.twilioConn, {
            event: "clear",
            streamSid: session.streamSid,
          });
          console.log("🧹 Cleared Twilio buffer after truncation error");
        }
        return;
      }
    }

    jsonSend(session.frontendConn, event);

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        console.log(`🗣️ User started speaking [${session.streamSid}]`);
        handleTruncation(session);
        break;

      case "input_audio_buffer.speech_stopped":
        console.log(`🤐 User stopped speaking [${session.streamSid}]`);
        break;

      case "response.done":
        console.log(`✅ Response completed [${session.streamSid}]`);
        break;

      case "session.created":
        console.log(`📝 Session created [${session.streamSid}]:`, JSON.stringify(event, null, 2));
        break;

      case "conversation.item.input_audio_transcription.completed":
        console.log(`🗣️ User said [${session.streamSid}]:`, event.transcript);
        if (session.streamSid) {
          trackUserMessage(session.streamSid, event.transcript);
        }
        break;

      case "response.audio_transcript.done":
        console.log(`🤖 Assistant said [${session.streamSid}]:`, event.transcript);
        if (session.streamSid) {
          trackAssistantMessage(session.streamSid, event.transcript);
        }
        break;

      case "response.output_item.added":
        console.log(`➕ Output item added [${session.streamSid}]:`, event.item?.type);
        break;

      case "response.audio.delta":
        if (session.twilioConn && session.streamSid) {
          if (session.responseStartTimestamp === undefined) {
            session.responseStartTimestamp = session.latestMediaTimestamp || 0;
            session.audioDurationMs = 0;
            session.audioChunkCount = 0;
            console.log(`🔊 Starting audio response [${session.streamSid}]`);
          }
          if (event.item_id) session.lastAssistantItem = event.item_id;

          if (event.delta) {
            session.audioChunkCount = (session.audioChunkCount || 0) + 1;
            session.audioDurationMs = (session.audioChunkCount || 0) * 20;
          }

          // Only do local recording if not using Twilio recording
          if (process.env.ENABLE_RECORDING !== "false" && !process.env.PUBLIC_URL && event.delta) {
            const audioBuffer = Buffer.from(event.delta, 'base64');
            recordingManager.writeOutboundAudio(session.streamSid, audioBuffer);
          }

          jsonSend(session.twilioConn, {
            event: "media",
            streamSid: session.streamSid,
            media: { payload: event.delta },
          });

          jsonSend(session.twilioConn, {
            event: "mark",
            streamSid: session.streamSid,
          });
        } else {
          console.warn(`⚠️ No Twilio connection for audio output [${session.streamSid}]`);
        }
        break;

      case "response.output_item.done": {
        const { item } = event;
        if (item.type === "function_call") {
          handleFunctionCall(item)
            .then((output) => {
              if (session.modelConn) {
                jsonSend(session.modelConn, {
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: item.call_id,
                    output: JSON.stringify(output),
                  },
                });
                jsonSend(session.modelConn, { type: "response.create" });
                if (session.streamSid) {
                  trackFunctionCall(session.streamSid, item.name, JSON.parse(item.arguments), output);
                }
                
                // Check if we need to hang up the call
                if (sessionControl.shouldHangUp) {
                  console.log(`📞 Hanging up call for session ${session.streamSid} - Reason: ${sessionControl.hangUpReason}`);
                  
                  // Close the OpenAI connection immediately to prevent any AI speech
                  if (session.modelConn && isOpen(session.modelConn)) {
                    console.log(`🔌 Closing OpenAI connection immediately`);
                    session.modelConn.close();
                    session.modelConn = undefined;
                  }
                  
                  // Play consent denial audio if needed
                  if (sessionControl.shouldPlayConsentDenialAudio && session.twilioConn && session.streamSid) {
                    console.log(`🎵 Playing consent denial pre-recorded message`);
                    
                    getConsentDenialAudioChunks()
                      .then((audioChunks) => {
                        // Play all audio chunks with 20ms spacing
                        audioChunks.forEach((chunk, index) => {
                          setTimeout(() => {
                            if (isOpen(session.twilioConn)) {
                              jsonSend(session.twilioConn, {
                                event: "media",
                                streamSid: session.streamSid,
                                media: { payload: chunk },
                              });
                            }
                          }, index * 20);
                        });
                        
                        // Calculate total audio duration and hang up after completion
                        const audioDurationMs = audioChunks.length * 20;
                        const hangupDelayMs = audioDurationMs + 1000; // 1 second buffer
                        
                        setTimeout(() => {
                          if (session.twilioConn && isOpen(session.twilioConn)) {
                            console.log(`🔌 Closing Twilio connection after audio playback`);
                            session.twilioConn.close();
                          }
                        }, hangupDelayMs);
                      })
                      .catch((error) => {
                        console.error(`❌ Failed to play consent denial audio:`, error);
                        // Hang up immediately on error
                        if (session.twilioConn && isOpen(session.twilioConn)) {
                          session.twilioConn.close();
                        }
                      });
                  } else {
                    // For other hangup reasons, close immediately
                    if (session.twilioConn && isOpen(session.twilioConn)) {
                      console.log(`🔌 Closing Twilio connection`);
                      session.twilioConn.close();
                    }
                  }
                  
                  // Reset the control flags
                  sessionControl.shouldHangUp = false;
                  sessionControl.hangUpReason = "";
                  sessionControl.shouldPlayConsentDenialAudio = false;
                }
              }
            })
            .catch((err) => {
              console.error("Error handling function call:", err);
            });
        }
        break;
      }
    }
  },
  { name: "handleModelMessage", metadata: { type: "model-handler" } }
);

function handleTruncation(session: Session) {
  if (
    !session.lastAssistantItem ||
    session.responseStartTimestamp === undefined
  )
    return;

  const elapsedMs =
    (session.latestMediaTimestamp || 0) - (session.responseStartTimestamp || 0);
  const audio_end_ms = elapsedMs > 0 ? elapsedMs : 0;

  const MIN_TRUNCATION_MS = 100;
  if (audio_end_ms < MIN_TRUNCATION_MS) {
    console.log(`⚠️ Skipping truncation: audio too short (${audio_end_ms}ms < ${MIN_TRUNCATION_MS}ms)`);
    session.lastAssistantItem = undefined;
    session.responseStartTimestamp = undefined;
    session.audioDurationMs = undefined;
    session.audioChunkCount = undefined;
    return;
  }

  console.log(`✂️ Attempting truncation at ${audio_end_ms}ms - lastItem: ${session.lastAssistantItem}`);

  if (session.audioDurationMs && audio_end_ms > session.audioDurationMs + 100) {
    console.warn(`⚠️ Skipping truncation: calculated time (${audio_end_ms}ms) exceeds estimated duration (${session.audioDurationMs}ms)`);
    session.lastAssistantItem = undefined;
    session.responseStartTimestamp = undefined;
    session.audioDurationMs = undefined;
    session.audioChunkCount = undefined;

    if (session.twilioConn && session.streamSid && isOpen(session.twilioConn)) {
      jsonSend(session.twilioConn, {
        event: "clear",
        streamSid: session.streamSid,
      });
    }
    return;
  }

  if (session.modelConn && isOpen(session.modelConn)) {
    try {
      jsonSend(session.modelConn, {
        type: "conversation.item.truncate",
        item_id: session.lastAssistantItem,
        content_index: 0,
        audio_end_ms,
      });

      console.log(`✅ Truncation request sent successfully for ${audio_end_ms}ms`);
    } catch (error) {
      console.error("❌ Error sending truncation request:", error);
    }
  }

  if (session.twilioConn && session.streamSid && isOpen(session.twilioConn)) {
    try {
      jsonSend(session.twilioConn, {
        event: "clear",
        streamSid: session.streamSid,
      });
      console.log("🧹 Cleared Twilio audio buffer");
    } catch (error) {
      console.error("❌ Error clearing Twilio buffer:", error);
    }
  }

  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
  session.audioDurationMs = undefined;
  session.audioChunkCount = undefined;
  console.log("🔄 Reset session audio state");
}

function closeModel(session: Session) {
  cleanupConnection(session.modelConn);
  session.modelConn = undefined;
  // Don't remove session here - let the main connection handle cleanup
}

function closeAllConnections(session: Session) {
  if (session.twilioConn) {
    session.twilioConn.close();
    session.twilioConn = undefined;
  }
  if (session.modelConn) {
    session.modelConn.close();
    session.modelConn = undefined;
  }
  if (session.frontendConn) {
    session.frontendConn.close();
    session.frontendConn = undefined;
  }
  session.streamSid = undefined;
  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
  session.latestMediaTimestamp = undefined;
  session.audioDurationMs = undefined;
  session.audioChunkCount = undefined;
  session.saved_config = undefined;
}

function cleanupConnection(ws?: WebSocket) {
  if (isOpen(ws)) ws.close();
}

function parseMessage(data: RawData): any {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  if (!isOpen(ws)) return;
  ws.send(JSON.stringify(obj));
}

function isOpen(ws?: WebSocket): ws is WebSocket {
  return !!ws && ws.readyState === WebSocket.OPEN;
}