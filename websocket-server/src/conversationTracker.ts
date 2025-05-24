import { RunTree } from "langsmith";
import { traceable } from "./tracing";

interface ConversationSession {
  conversationId: string;
  runTree?: RunTree;
  userMessages: string[];
  assistantMessages: string[];
  startTime: Date;
}

const conversations = new Map<string, ConversationSession>();

export function startConversation(sessionId: string) {
  const conversation: ConversationSession = {
    conversationId: sessionId,
    userMessages: [],
    assistantMessages: [],
    startTime: new Date(),
  };
  
  // Create a parent run for the entire conversation
  conversation.runTree = new RunTree({
    name: "Voice Conversation",
    run_type: "chain",
    inputs: {
      sessionId,
      startTime: conversation.startTime.toISOString(),
    },
    metadata: {
      provider: process.env.USE_AZURE_OPENAI === "true" ? "Azure" : "OpenAI",
    },
  });
  
  conversations.set(sessionId, conversation);
  return conversation;
}

export const trackUserMessage = traceable(
  async function trackUserMessage(sessionId: string, transcript: string) {
    const conversation = conversations.get(sessionId);
    if (!conversation) return;
    
    conversation.userMessages.push(transcript);
    
    // Create a child run for this user message
    const childRun = conversation.runTree?.createChild({
      name: "User Message",
      run_type: "prompt",
      inputs: { transcript },
    });
    
    await childRun?.end({
      outputs: { recorded: true },
    });
    
    await childRun?.postRun();
  },
  { name: "trackUserMessage" }
);

export const trackAssistantMessage = traceable(
  async function trackAssistantMessage(sessionId: string, transcript: string) {
    const conversation = conversations.get(sessionId);
    if (!conversation) return;
    
    conversation.assistantMessages.push(transcript);
    
    // Create a child run for this assistant message
    const childRun = conversation.runTree?.createChild({
      name: "Assistant Response",
      run_type: "llm",
      inputs: { 
        lastUserMessage: conversation.userMessages[conversation.userMessages.length - 1] 
      },
      outputs: { transcript },
    });
    
    await childRun?.end();
    await childRun?.postRun();
  },
  { name: "trackAssistantMessage" }
);

export const trackFunctionCall = traceable(
  async function trackFunctionCall(
    sessionId: string, 
    functionName: string, 
    args: any, 
    result: any
  ) {
    const conversation = conversations.get(sessionId);
    if (!conversation) return;
    
    // Create a child run for this function call
    const childRun = conversation.runTree?.createChild({
      name: `Function: ${functionName}`,
      run_type: "tool",
      inputs: args,
      outputs: result,
    });
    
    await childRun?.end();
    await childRun?.postRun();
  },
  { name: "trackFunctionCall" }
);

export async function endConversation(sessionId: string) {
  const conversation = conversations.get(sessionId);
  if (!conversation) return;
  
  // End the parent run with a summary
  await conversation.runTree?.end({
    outputs: {
      duration: new Date().getTime() - conversation.startTime.getTime(),
      userMessageCount: conversation.userMessages.length,
      assistantMessageCount: conversation.assistantMessages.length,
      userMessages: conversation.userMessages,
      assistantMessages: conversation.assistantMessages,
    },
  });
  
  await conversation.runTree?.postRun();
  conversations.delete(sessionId);
}