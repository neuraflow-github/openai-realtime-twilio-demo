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

// Enhanced traceable wrapper that explicitly logs inputs and outputs
export function traceableFunction<T extends (...args: any[]) => any>(
  fn: T,
  options: {
    name: string;
    metadata?: Record<string, any>;
  }
): T {
  return traceable(
    async (...args: Parameters<T>): Promise<ReturnType<T>> => {
      // Log input
      const input = args.length === 1 ? args[0] : args;
      logLangSmithEvent(`${options.name}_input`, { input });
      
      try {
        // Execute function
        const result = await fn(...args);
        
        // Log output
        logLangSmithEvent(`${options.name}_output`, { output: result });
        
        return result;
      } catch (error) {
        // Log error
        logLangSmithEvent(`${options.name}_error`, { 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw error;
      }
    },
    {
      ...options,
      run_type: "llm", // This helps Langsmith understand it's a function call
      metadata: {
        ...options.metadata,
        function_type: "realtime_assistant_tool"
      }
    }
  ) as T;
}