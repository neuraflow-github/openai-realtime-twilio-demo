import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import cors from "cors";
import {
  handleCallConnection,
  handleFrontendConnection,
} from "./sessionManager";
import functions from "./functionHandlers";
import { AzureOpenAIConfig } from "./azureConfig";

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

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf-8");

app.get("/public-url", (req, res) => {
  res.json({ publicUrl: PUBLIC_URL });
});

app.all("/twiml", (req, res) => {
  const wsUrl = new URL(PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `/call`;

  const twimlContent = twimlTemplate.replace("{{WS_URL}}", wsUrl.toString());
  res.type("text/xml").send(twimlContent);
});

// New endpoint to list available tools (schemas)
app.get("/tools", (req, res) => {
  res.json(functions.map((f) => f.schema));
});

let currentCall: WebSocket | null = null;
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
    if (currentCall) currentCall.close();
    currentCall = ws;
    handleCallConnection(currentCall, OPENAI_API_KEY, azureConfig);
    console.log(`Using ${USE_AZURE_OPENAI ? 'Azure OpenAI' : 'OpenAI'} for voice calls`);
  } else if (type === "logs") {
    if (currentLogs) currentLogs.close();
    currentLogs = ws;
    handleFrontendConnection(currentLogs);
  } else {
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
