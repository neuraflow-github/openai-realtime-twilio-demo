import express, { Request, Response } from "express";
import { WebSocket } from "ws";
import dotenv from "dotenv";
import { SYSTEM_PROMPT, VOICE_CONFIG } from "./systemPrompt";
import functions from "./functionHandlers";
import { AzureOpenAIConfig, getAzureRealtimeUrl, getAzureHeaders } from "./azureConfig";

dotenv.config();

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.LANGSMITH_SERVER_PORT || 3000;
const USE_AZURE_OPENAI = process.env.USE_AZURE_OPENAI === "true";
const OPENAI_API_KEY = USE_AZURE_OPENAI
  ? (process.env.AZURE_OPENAI_API_KEY || "")
  : (process.env.OPENAI_API_KEY || "");

if (!OPENAI_API_KEY) {
  console.error(`❌ ${USE_AZURE_OPENAI ? 'AZURE_OPENAI_API_KEY' : 'OPENAI_API_KEY'} environment variable is required`);
  process.exit(1);
}

// Azure configuration
const azureConfig: AzureOpenAIConfig | undefined = USE_AZURE_OPENAI ? {
  useAzure: true,
  azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
  azureDeployment: process.env.AZURE_OPENAI_DEPLOYMENT,
  azureApiVersion: process.env.AZURE_API_VERSION || "2024-12-17"
} : undefined;

// LangSmith compatible invoke endpoint
app.post("/invoke", async (req: Request, res: Response): Promise<void> => {
  try {
    console.log("📥 Received request body:", JSON.stringify(req.body, null, 2));
    
    const { input, messages, config = {} } = req.body;

    // Handle both LangServe formats: input or messages
    let userMessage = "";
    if (input) {
      // LangServe format with input
      if (typeof input === "string") {
        userMessage = input;
      } else if (input.messages && Array.isArray(input.messages)) {
        userMessage = input.messages[input.messages.length - 1]?.content || "";
      } else {
        console.error("❌ Invalid input format:", input);
        res.status(400).json({ 
          error: "Invalid input format. Expected string or object with messages array",
          received: typeof input,
          details: "Input should be a string or an object containing a messages array"
        });
        return;
      }
    } else if (messages && Array.isArray(messages)) {
      // Direct messages format
      userMessage = messages[messages.length - 1]?.content || "";
    } else {
      console.error("❌ No valid input found. Body:", req.body);
      res.status(400).json({ 
        error: "Either 'input' or 'messages' array is required",
        received: {
          hasInput: !!input,
          hasMessages: !!messages,
          messagesIsArray: Array.isArray(messages),
          bodyKeys: Object.keys(req.body)
        },
        examples: {
          format1: { input: "Hello, how are you?" },
          format2: { input: { messages: [{ role: "user", content: "Hello" }] } },
          format3: { messages: [{ role: "user", content: "Hello" }] }
        }
      });
      return;
    }

    if (!userMessage) {
      console.error("❌ Empty user message extracted");
      res.status(400).json({ 
        error: "No user message content found",
        details: "The message content appears to be empty"
      });
      return;
    }

    console.log("📝 Extracted user message:", userMessage);

    // Extract configurable parameters
    const {
      voice = VOICE_CONFIG.voice,
      temperature = 0.8,
      max_tokens = 4096,
      instructions = SYSTEM_PROMPT
    } = config;

    console.log("⚙️ Using config:", { voice, temperature, max_tokens });

    // Create WebSocket connection to OpenAI
    const response = await getOpenAIResponse(userMessage, {
      voice,
      temperature,
      max_tokens,
      instructions
    });

    console.log("✅ Generated response:", response);

    res.json({
      output: response,
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });
  } catch (error) {
    console.error("❌ Error in /invoke:", error);
    res.status(500).json({ 
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error),
      stack: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.stack : undefined) : undefined
    });
  }
});

// Configurable fields endpoint for LangSmith
app.get("/configurable_fields", (_req: Request, res: Response): void => {
  res.json({
    fields: [
      {
        id: "voice",
        name: "Voice",
        description: "Voice to use for the assistant",
        type: "string",
        default: VOICE_CONFIG.voice,
        enum: ["shimmer", "alloy", "echo", "fable", "onyx", "nova"]
      },
      {
        id: "temperature",
        name: "Temperature",
        description: "Sampling temperature (0-2)",
        type: "number",
        default: 0.8,
        min: 0,
        max: 2
      },
      {
        id: "max_tokens",
        name: "Max Tokens",
        description: "Maximum tokens in response",
        type: "number",
        default: 4096,
        min: 1,
        max: 128000
      },
      {
        id: "instructions",
        name: "System Instructions",
        description: "System prompt for the assistant",
        type: "string",
        default: SYSTEM_PROMPT
      }
    ]
  });
});

// Health check endpoint
app.get("/health", (_req: Request, res: Response): void => {
  res.json({ status: "ok", model: "openai-realtime-voice" });
});

// Function to get response from OpenAI Realtime API
async function getOpenAIResponse(
  message: string,
  config: {
    voice: string;
    temperature: number;
    max_tokens: number;
    instructions: string;
  }
): Promise<string> {
  return new Promise((resolve, reject) => {
    let wsUrl: string;
    let headers: Record<string, string>;

    if (azureConfig?.useAzure) {
      wsUrl = getAzureRealtimeUrl(azureConfig);
      headers = getAzureHeaders(OPENAI_API_KEY);
    } else {
      wsUrl = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";
      headers = {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      };
    }

    const ws = new WebSocket(wsUrl, { headers });
    let responseText = "";

    ws.on("open", () => {
      // Register available tools
      const tools = functions.map(f => ({
        type: "function",
        name: f.schema.name,
        description: f.schema.description,
        parameters: f.schema.parameters
      }));

      // Configure session
      const sessionConfig = {
        type: "session.update",
        session: {
          modalities: ["text"],
          instructions: config.instructions,
          voice: config.voice,
          temperature: config.temperature,
          max_response_output_tokens: config.max_tokens,
          tools: tools
        }
      };

      ws.send(JSON.stringify(sessionConfig));

      // Send user message
      ws.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: message
          }]
        }
      }));

      // Request response
      ws.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text"]
        }
      }));
    });

    ws.on("message", async (data: any) => {
      const event = JSON.parse(data.toString());

      switch (event.type) {
        case "response.text.delta":
          responseText += event.delta;
          break;

        case "response.text.done":
          ws.close();
          resolve(responseText);
          break;

        case "response.output_item.done":
          if (event.item.type === "function_call") {
            const fnDef = functions.find(f => f.schema.name === event.item.name);
            if (fnDef) {
              try {
                const args = JSON.parse(event.item.arguments);
                const result = await fnDef.handler(args);

                // Send function result back
                ws.send(JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: event.item.call_id,
                    output: JSON.stringify(result)
                  }
                }));

                // Generate response
                ws.send(JSON.stringify({ type: "response.create" }));
              } catch (error) {
                console.error(`Function error: ${error}`);
                ws.close();
                reject(error);
              }
            }
          }
          break;

        case "error":
          ws.close();
          reject(new Error(event.error.message));
          break;
      }
    });

    ws.on("error", (error) => {
      reject(error);
    });

    ws.on("close", () => {
      if (!responseText) {
        reject(new Error("Connection closed without response"));
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      ws.close();
      reject(new Error("Request timeout"));
    }, 30000);
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 LangSmith-compatible server running on http://localhost:${PORT}`);
  console.log(`📌 Use this URL in LangSmith playground: http://localhost:${PORT}`);
  console.log(`\n Available endpoints:`);
  console.log(`   POST /invoke - Main model endpoint`);
  console.log(`   GET /configurable_fields - Get configurable parameters`);
  console.log(`   GET /health - Health check`);
});

export default app;