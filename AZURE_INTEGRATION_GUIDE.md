# Azure OpenAI Integration Guide

## Overview

This guide explains how to use Azure OpenAI's Realtime API (Sweden Central) with your Twilio voice agent instead of OpenAI's API.

## Key Information

- **Available Regions**: East US 2 and Sweden Central (as per your requirement)
- **API Version**: `2024-12-17` or `2025-04-01-preview`
- **Model**: `gpt-4o-realtime-preview` or `gpt-4o-mini-realtime-preview`

## Setup Steps

### 1. Create Azure OpenAI Resource

1. Go to Azure Portal
2. Create an Azure OpenAI resource in **Sweden Central** region
3. Deploy the `gpt-4o-realtime-preview` model
4. Note down:
   - Your resource endpoint (e.g., `my-resource.openai.azure.com`)
   - Your deployment name
   - Your API key

### 2. Configure Environment Variables

Update your `.env` file:

```env
# Switch to Azure OpenAI
USE_AZURE_OPENAI=true

# Azure OpenAI Configuration
AZURE_OPENAI_API_KEY="your-azure-api-key"
AZURE_OPENAI_ENDPOINT="your-resource.openai.azure.com"  # Without https://
AZURE_OPENAI_DEPLOYMENT="gpt-4o-realtime-preview"       # Your deployment name
AZURE_API_VERSION="2024-12-17"                          # or "2025-04-01-preview"

# Keep your existing OpenAI key as fallback
OPENAI_API_KEY="your-openai-key"

# Server Configuration (unchanged)
PUBLIC_URL="your-ngrok-url"
TAVILY_API_KEY="your-tavily-key"
```

### 3. Start the Server

The server automatically detects Azure configuration:

```bash
npm run dev
```

You'll see in the logs:
```
Using Azure OpenAI for voice calls
Connecting to Azure OpenAI: wss://your-resource.openai.azure.com/openai/realtime?api-version=2024-12-17&deployment=gpt-4o-realtime-preview
```

## Technical Details

### WebSocket URL Format

Azure uses a different URL structure:
- **OpenAI**: `wss://api.openai.com/v1/realtime?model=MODEL_NAME`
- **Azure**: `wss://RESOURCE.openai.azure.com/openai/realtime?api-version=VERSION&deployment=DEPLOYMENT_NAME`

### Authentication

Azure uses different headers:
- **OpenAI**: `Authorization: Bearer API_KEY`
- **Azure**: `api-key: API_KEY`

Both use: `OpenAI-Beta: realtime=v1`

### Code Architecture

The implementation uses:
1. `azureConfig.ts` - Handles Azure-specific configuration
2. `sessionManager.ts` - Dynamically switches between OpenAI and Azure
3. `server.ts` - Reads environment variables and configures the service

## Switching Between Providers

To switch back to OpenAI:
```env
USE_AZURE_OPENAI=false
```

To use Azure:
```env
USE_AZURE_OPENAI=true
```

## Troubleshooting

### Common Issues

1. **Connection Failed**
   - Verify your Azure endpoint doesn't include `https://`
   - Check deployment name matches exactly
   - Ensure model is deployed in Sweden Central

2. **Authentication Error**
   - Verify API key is correct
   - Check you're using the right environment variable

3. **Model Not Found**
   - Ensure you've deployed the realtime model
   - Verify deployment name in Azure Portal

### Debug Information

The server logs connection details:
- Which provider is being used
- The full WebSocket URL
- Connection status

## Benefits of Azure OpenAI

1. **Data Residency**: Processing stays in Sweden/EU
2. **Compliance**: Better for GDPR requirements
3. **Enterprise Features**: Integration with Azure services
4. **SLA**: Enterprise-grade service agreements

## Next Steps

1. Test the connection by calling your Twilio number
2. Monitor Azure OpenAI metrics in Azure Portal
3. Set up Azure Application Insights for monitoring
4. Configure Azure cost alerts
