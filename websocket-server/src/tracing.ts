import { traceable } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers";
import { Client } from "langsmith";

// Initialize LangSmith client
export const langsmithClient = new Client({
  apiUrl: process.env.LANGSMITH_ENDPOINT,
  apiKey: process.env.LANGSMITH_API_KEY,
});

// Export traceable decorator for use in other files
export { traceable };

// Helper function to wrap OpenAI client instances
export function wrapOpenAIClient(client: any) {
  return wrapOpenAI(client);
}

// Helper to log custom events
export function logLangSmithEvent(eventName: string, metadata?: any) {
  if (process.env.LANGSMITH_TRACING === "true") {
    console.log(`[LangSmith] ${eventName}`, metadata ? JSON.stringify(metadata) : "");
  }
}