import { RawData, WebSocket } from "ws";
import functions from "./functionHandlers";
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

interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  modelConn?: WebSocket;
  streamSid?: string;
  saved_config?: any;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  openAIApiKey?: string;
  azureConfig?: AzureOpenAIConfig;
}

let session: Session = {};

export const handleCallConnection = traceable(
  async function handleCallConnection(
    ws: WebSocket, 
    openAIApiKey: string,
    azureConfig?: AzureOpenAIConfig
  ) {
  cleanupConnection(session.twilioConn);
  session.twilioConn = ws;
  session.openAIApiKey = openAIApiKey;
  session.azureConfig = azureConfig;

  ws.on("message", handleTwilioMessage);
  ws.on("error", ws.close);
  ws.on("close", () => {
    if (session.streamSid) {
      endConversation(session.streamSid);
    }
    cleanupConnection(session.modelConn);
    cleanupConnection(session.twilioConn);
    session.twilioConn = undefined;
    session.modelConn = undefined;
    session.streamSid = undefined;
    session.lastAssistantItem = undefined;
    session.responseStartTimestamp = undefined;
    session.latestMediaTimestamp = undefined;
    if (!session.frontendConn) session = {};
  });
  },
  { name: "handleCallConnection", metadata: { type: "websocket-handler" } }
);

export function handleFrontendConnection(ws: WebSocket) {
  cleanupConnection(session.frontendConn);
  session.frontendConn = ws;

  ws.on("message", handleFrontendMessage);
  ws.on("close", () => {
    cleanupConnection(session.frontendConn);
    session.frontendConn = undefined;
    if (!session.twilioConn && !session.modelConn) session = {};
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

function handleTwilioMessage(data: RawData) {
  const msg = parseMessage(data);
  if (!msg) return;

  // Only log non-media events to reduce noise
  if (msg.event !== "media") {
    console.log("📞 Twilio message:", msg.event);
  }
  
  switch (msg.event) {
    case "start":
      session.streamSid = msg.start.streamSid;
      session.latestMediaTimestamp = 0;
      session.lastAssistantItem = undefined;
      session.responseStartTimestamp = undefined;
      // Start tracking the conversation
      startConversation(session.streamSid!);
      tryConnectModel();
      break;
    case "media":
      session.latestMediaTimestamp = msg.media.timestamp;
      if (isOpen(session.modelConn)) {
        const audioEvent = {
          type: "input_audio_buffer.append",
          audio: msg.media.payload,
        };
        // Log only periodically to avoid spam
        if (Math.random() < 0.05) {
          console.log("🎤 Sending audio chunk to model");
        }
        jsonSend(session.modelConn, audioEvent);
      }
      break;
    case "close":
      if (session.streamSid) {
        endConversation(session.streamSid);
      }
      closeAllConnections();
      break;
  }
}

function handleFrontendMessage(data: RawData) {
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
  function tryConnectModel() {
    if (!session.twilioConn || !session.streamSid || !session.openAIApiKey)
      return;
    if (isOpen(session.modelConn)) return;

  // Determine WebSocket URL and headers based on Azure config
  let wsUrl: string;
  let headers: Record<string, string>;
  
  if (session.azureConfig?.useAzure) {
    wsUrl = getAzureRealtimeUrl(session.azureConfig);
    headers = getAzureHeaders(session.openAIApiKey);
    console.log("Connecting to Azure OpenAI:", wsUrl);
  } else {
    wsUrl = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";
    headers = {
      Authorization: `Bearer ${session.openAIApiKey}`,
      "OpenAI-Beta": "realtime=v1",
    };
    console.log("Connecting to OpenAI:", wsUrl);
  }

  session.modelConn = new WebSocket(wsUrl, { headers });

  session.modelConn.on("open", () => {
    console.log("✅ WebSocket connected successfully");
    const config = session.saved_config || {};

    // Register available tools
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
    
    // Send a greeting message to start the conversation if enabled
    if (INITIAL_GREETING.enabled) {
      setTimeout(() => {
        if (isOpen(session.modelConn)) {
          console.log("👋 Sending greeting message");
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

  session.modelConn.on("message", handleModelMessage);
  session.modelConn.on("error", (error) => {
    console.error("❌ WebSocket error:", error);
    closeModel();
  });
  session.modelConn.on("close", (code, reason) => {
    console.log("🔌 WebSocket closed. Code:", code, "Reason:", reason.toString());
    closeModel();
  });
  },
  { name: "tryConnectModel", metadata: { type: "connection" } }
);

const handleModelMessage = traceable(
  function handleModelMessage(data: RawData) {
  const event = parseMessage(data);
  if (!event) return;

  console.log("🤖 Model event:", event.type);
  if (event.type === "error") {
    console.error("❌ Model error:", JSON.stringify(event, null, 2));
  }
  
  jsonSend(session.frontendConn, event);

  switch (event.type) {
    case "input_audio_buffer.speech_started":
      console.log("🗣️ User started speaking");
      handleTruncation();
      break;
      
    case "input_audio_buffer.speech_stopped":
      console.log("🤐 User stopped speaking");
      break;
      
    case "response.done":
      console.log("✅ Response completed");
      break;
      
    case "session.created":
      console.log("📝 Session created:", JSON.stringify(event, null, 2));
      break;
      
    case "conversation.item.input_audio_transcription.completed":
      console.log("🗣️ User said:", event.transcript);
      if (session.streamSid) {
        trackUserMessage(session.streamSid, event.transcript);
      }
      break;
      
    case "response.audio_transcript.done":
      console.log("🤖 Assistant said:", event.transcript);
      if (session.streamSid) {
        trackAssistantMessage(session.streamSid, event.transcript);
      }
      break;
      
    case "response.output_item.added":
      console.log("➕ Output item added:", event.item?.type);
      break;

    case "response.audio.delta":
      if (session.twilioConn && session.streamSid) {
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = session.latestMediaTimestamp || 0;
          console.log("🔊 Starting audio response");
        }
        if (event.item_id) session.lastAssistantItem = event.item_id;

        // Log periodically
        if (Math.random() < 0.1) {
          console.log("🔊 Sending audio to Twilio");
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
        console.warn("⚠️ No Twilio connection for audio output");
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

function handleTruncation() {
  if (
    !session.lastAssistantItem ||
    session.responseStartTimestamp === undefined
  )
    return;

  const elapsedMs =
    (session.latestMediaTimestamp || 0) - (session.responseStartTimestamp || 0);
  const audio_end_ms = elapsedMs > 0 ? elapsedMs : 0;

  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, {
      type: "conversation.item.truncate",
      item_id: session.lastAssistantItem,
      content_index: 0,
      audio_end_ms,
    });
  }

  if (session.twilioConn && session.streamSid) {
    jsonSend(session.twilioConn, {
      event: "clear",
      streamSid: session.streamSid,
    });
  }

  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
}

function closeModel() {
  cleanupConnection(session.modelConn);
  session.modelConn = undefined;
  if (!session.twilioConn && !session.frontendConn) session = {};
}

function closeAllConnections() {
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
