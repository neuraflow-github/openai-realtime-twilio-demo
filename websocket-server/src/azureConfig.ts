// Configuration for Azure OpenAI
export interface AzureOpenAIConfig {
  useAzure: boolean;
  azureEndpoint?: string;  // e.g., "my-resource.openai.azure.com"
  azureDeployment?: string;  // e.g., "gpt-4o-realtime-preview"
  azureApiVersion?: string;  // e.g., "2024-12-17" or "2025-04-01-preview"
}

// Get Azure URL for Realtime API
export function getAzureRealtimeUrl(config: AzureOpenAIConfig): string {
  if (!config.azureEndpoint || !config.azureDeployment) {
    throw new Error("Azure endpoint and deployment are required");
  }
  
  // Remove https:// and trailing slashes if present in endpoint
  const cleanEndpoint = config.azureEndpoint
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  
  const apiVersion = config.azureApiVersion || "2024-12-17";
  
  // URL encode the deployment name in case it has special characters
  const encodedDeployment = encodeURIComponent(config.azureDeployment);
  
  // Construct the WebSocket URL for Azure
  const url = `wss://${cleanEndpoint}/openai/realtime?api-version=${apiVersion}&deployment=${encodedDeployment}`;
  
  console.log("🔗 Azure WebSocket URL:", url);
  return url;
}

// Get headers for Azure authentication
export function getAzureHeaders(apiKey: string): Record<string, string> {
  return {
    "api-key": apiKey
  };
}
