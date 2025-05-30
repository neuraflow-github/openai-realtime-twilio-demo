import express, { Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import http from "http";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import cors from "cors";
import {
  handleCallConnection,
  handleFrontendConnection,
} from "./sessionManager";
import functions from "./functionHandlers";
import { AzureOpenAIConfig } from "./azureConfig";
import { logLangSmithEvent } from "./tracing";
import { recordingManager } from "./recordingManager";
import { preloadAudio } from "./prerecordedAudio";

dotenv.config();

const PORT = parseInt(process.env.PORT || "8081", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";

// Azure or OpenAI configuration
const USE_AZURE_OPENAI = process.env.USE_AZURE_OPENAI === "true";
const OPENAI_API_KEY = USE_AZURE_OPENAI
  ? (process.env.AZURE_OPENAI_API_KEY || "")
  : (process.env.OPENAI_API_KEY || "");

if (!OPENAI_API_KEY) {
  console.error(`${USE_AZURE_OPENAI ? 'AZURE_OPENAI_API_KEY' : 'OPENAI_API_KEY'} environment variable is required`);
  process.exit(1);
}

// Azure configuration
const azureConfig: AzureOpenAIConfig | undefined = USE_AZURE_OPENAI ? {
  useAzure: true,
  azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
  azureDeployment: process.env.AZURE_OPENAI_DEPLOYMENT,
  azureApiVersion: process.env.AZURE_API_VERSION || "2024-12-17"
} : undefined;

if (USE_AZURE_OPENAI) {
  console.log("🔧 Azure Configuration:");
  console.log("  Endpoint:", process.env.AZURE_OPENAI_ENDPOINT);
  console.log("  Deployment:", process.env.AZURE_OPENAI_DEPLOYMENT);
  console.log("  API Version:", process.env.AZURE_API_VERSION);
}

if (USE_AZURE_OPENAI && (!azureConfig?.azureEndpoint || !azureConfig?.azureDeployment)) {
  console.error("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT are required when USE_AZURE_OPENAI is true");
  process.exit(1);
}

// Recording configuration
const ENABLE_RECORDING = process.env.ENABLE_RECORDING !== "false"; // Default to true
const RECORDING_FORMAT = (process.env.RECORDING_FORMAT || "mp3") as "mp3" | "wav";
const RECORDING_PROCESS = process.env.RECORDING_PROCESS !== "false"; // Default to true

if (ENABLE_RECORDING) {
  recordingManager.setOptions({
    enableProcessing: RECORDING_PROCESS,
    outputFormat: RECORDING_FORMAT
  });
  console.log("🎙️  Recording Configuration:");
  console.log(`  Enabled: ${ENABLE_RECORDING}`);
  console.log(`  Format: ${RECORDING_FORMAT}`);
  console.log(`  Processing: ${RECORDING_PROCESS}`);
  console.log(`  Directory: ${recordingManager.getRecordingsDirectory()}`);
}

const app = express();
app.use(cors({
  origin: [
    process.env.WEBAPP_URL || "http://localhost:3000",
    "http://localhost:3000"
  ],
  credentials: true
}));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf-8");

app.get("/public-url", (req, res) => {
  res.json({ publicUrl: PUBLIC_URL });
});

app.all("/twiml", (req, res) => {
  const wsUrl = new URL(PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `/call`;

  // Check if consent handling is disabled
  const consentDisabled = process.env.DISABLE_CONSENT_HANDLING === "true";
  
  let twimlContent;
  if (consentDisabled) {
    // Generate TwiML without the Play element
    twimlContent = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl.toString()}" />
  </Connect>
</Response>`;
  } else {
    // Use the template with the Play element
    twimlContent = twimlTemplate.replace("{{WS_URL}}", wsUrl.toString());
  }
  
  res.type("text/xml").send(twimlContent);
});

// New endpoint to list available tools (schemas)
app.get("/tools", (req, res) => {
  res.json(functions.map((f) => f.schema));
});

// Recording callback endpoint
app.post('/recording-callback', (req: Request, res: Response) => {
  const { RecordingSid, RecordingUrl, RecordingStatus, RecordingDuration, CallSid } = req.body;
  
  console.log(`📼 Recording Status Update:`, {
    callSid: CallSid,
    recordingSid: RecordingSid,
    status: RecordingStatus,
    duration: RecordingDuration,
    url: RecordingUrl
  });

  // Store recording metadata in your database or file system
  if (RecordingStatus === 'completed') {
    // You can download and store the recording here if needed
    // The recording URL will be: RecordingUrl + '.mp3' or '.wav'
  }

  res.status(200).send('OK');
});

// Recording management endpoints
app.get("/recordings", (_req: Request, res: Response): void => {
  try {
    const recordingsDir = recordingManager.getRecordingsDirectory();
    if (!existsSync(recordingsDir)) {
      res.json({ recordings: [] });
      return;
    }

    const recordings = readdirSync(recordingsDir)
      .filter((dir: string) => statSync(join(recordingsDir, dir)).isDirectory())
      .map((dir: string) => {
        const dirPath = join(recordingsDir, dir);
        const files = readdirSync(dirPath);
        const audioFiles = files.filter((f: string) =>
          f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.raw')
        );

        return {
          sessionId: dir.split('_')[0],
          timestamp: dir.split('_').slice(1).join('_'),
          directory: dir,
          files: audioFiles,
          path: dirPath
        };
      })
      .sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp));

    res.json({
      recordings,
      recordingsDir,
      activeRecordings: recordingManager.getActiveRecordings()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list recordings' });
  }
});

const activeCalls: Map<string, WebSocket> = new Map();
let currentLogs: WebSocket | null = null;

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 1) {
    ws.close();
    return;
  }

  const type = parts[0];

  if (type === "call") {
    const callId = `call_${Date.now()}_${Math.random()}`;
    activeCalls.set(callId, ws);

    handleCallConnection(ws, OPENAI_API_KEY, azureConfig);

    ws.on('close', () => {
      activeCalls.delete(callId);
    });
    console.log(`Using ${USE_AZURE_OPENAI ? 'Azure OpenAI' : 'OpenAI'} for voice calls`);
  } else if (type === "logs") {
    if (currentLogs) currentLogs.close();
    currentLogs = ws;
    handleFrontendConnection(currentLogs);
  } else {
    ws.close();
  }
});

server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  
  // Log consent handling configuration
  const consentDisabled = process.env.DISABLE_CONSENT_HANDLING === "true";
  console.log(`🔒 Consent handling: ${consentDisabled ? 'DISABLED' : 'ENABLED'}`);
  
  // Preload the consent denial audio
  if (!consentDisabled) {
    await preloadAudio();
  }
  
  if (process.env.LANGSMITH_TRACING === "true") {
    console.log("🦜 LangSmith tracing enabled");
    console.log(`📊 Project: ${process.env.LANGSMITH_PROJECT}`);
    logLangSmithEvent("server_started", { port: PORT, provider: USE_AZURE_OPENAI ? "Azure" : "OpenAI" });
  }
});
