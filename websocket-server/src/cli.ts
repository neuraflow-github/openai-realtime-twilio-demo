#!/usr/bin/env node

import { WebSocket } from "ws";
import * as readline from "readline";
import dotenv from "dotenv";
import { SYSTEM_PROMPT, VOICE_CONFIG } from "./systemPrompt";
import functions from "./functionHandlers";
import { AzureOpenAIConfig, getAzureRealtimeUrl, getAzureHeaders } from "./azureConfig";

dotenv.config();

// Configuration
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

// Terminal interface setup
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let ws: WebSocket | null = null;

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m"
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function connectToOpenAI() {
  // Determine WebSocket URL and headers
  let wsUrl: string;
  let headers: Record<string, string>;
  
  if (azureConfig?.useAzure) {
    wsUrl = getAzureRealtimeUrl(azureConfig);
    headers = getAzureHeaders(OPENAI_API_KEY);
    log("🔧 Connecting to Azure OpenAI...", colors.cyan);
  } else {
    wsUrl = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17";
    headers = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    };
    log("🔧 Connecting to OpenAI...", colors.cyan);
  }

  ws = new WebSocket(wsUrl, { headers });

  ws.on("open", () => {
    log("✅ Connected to OpenAI Realtime API", colors.green);
    
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
        instructions: SYSTEM_PROMPT,
        voice: VOICE_CONFIG.voice,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: {
          model: "whisper-1"
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 200
        },
        tools: tools
      }
    };
    
    if (ws) {
      ws.send(JSON.stringify(sessionConfig));
    }
    showHelp();
    promptUser();
  });

  ws.on("message", async (data: any) => {
    const event = JSON.parse(data.toString());
    
    switch (event.type) {
      case "response.text.delta":
        process.stdout.write(event.delta);
        break;
        
      case "response.text.done":
        console.log(); // New line after response
        promptUser();
        break;
        
      case "response.output_item.done":
        if (event.item.type === "function_call") {
          log(`\n🔧 Calling function: ${event.item.name}`, colors.magenta);
          const fnDef = functions.find(f => f.schema.name === event.item.name);
          if (fnDef) {
            try {
              const args = JSON.parse(event.item.arguments);
              const result = await fnDef.handler(args);
              
              // Send function result back
              if (ws && ws.readyState === WebSocket.OPEN) {
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
              }
            } catch (error) {
              log(`❌ Function error: ${error}`, colors.red);
              promptUser();
            }
          }
        }
        break;
        
      case "error":
        log(`\n❌ Error: ${event.error.message}`, colors.red);
        promptUser();
        break;
    }
  });

  ws.on("error", (error) => {
    log(`\n❌ WebSocket error: ${error}`, colors.red);
  });

  ws.on("close", () => {
    log("\n🔌 Disconnected from OpenAI", colors.yellow);
    process.exit(0);
  });
}

function showHelp() {
  log("\n📢 Voice CLI Ready! Commands:", colors.bright);
  log("  /help - Show this help message", colors.dim);
  log("  /clear - Clear conversation history", colors.dim);
  log("  /quit or /q - Exit the CLI", colors.dim);
  log("  Type anything else to chat\n", colors.dim);
}

function promptUser() {
  rl.question(`${colors.green}You: ${colors.reset}`, (input) => {
    handleInput(input.trim());
  });
}

function handleInput(input: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log("❌ Not connected to OpenAI", colors.red);
    promptUser();
    return;
  }

  // Handle commands
  if (input.startsWith("/")) {
    const command = input.toLowerCase();
    
    switch (command) {
      case "/help":
        showHelp();
        promptUser();
        return;
        
      case "/clear":
        // Note: The API doesn't support clearing conversation yet
        log("🧹 Clear conversation not yet supported by the API", colors.yellow);
        promptUser();
        return;
        
      case "/quit":
      case "/q":
        log("👋 Goodbye!", colors.yellow);
        process.exit(0);
        
      default:
        log(`❌ Unknown command: ${input}`, colors.red);
        promptUser();
        return;
    }
  }

  // Send regular message
  log(`${colors.cyan}Assistant: ${colors.reset}`, colors.cyan);
  
  ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: input
      }]
    }
  }));

  ws.send(JSON.stringify({ 
    type: "response.create",
    response: {
      modalities: ["text"]
    }
  }));
}

// Start the CLI
async function main() {
  console.clear();
  log("🎙️  OpenAI Realtime Voice CLI (Text Mode)", colors.bright);
  log("==========================================\n", colors.bright);
  
  await connectToOpenAI();
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  log("\n👋 Shutting down...", colors.yellow);
  if (ws) ws.close();
  process.exit(0);
});

// Run the CLI
main().catch((error) => {
  log(`❌ Fatal error: ${error}`, colors.red);
  process.exit(1);
});