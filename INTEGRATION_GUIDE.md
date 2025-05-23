# Integration Guide: Connecting Your Voice Agent to Phone

## Quick Setup Steps

### 1. Install Dependencies
```bash
cd /Users/pascal/openai-realtime-twilio-demo/websocket-server
npm install
npm install axios  # For Tavily search integration
```

### 2. Configure Environment Variables
Update the `.env` file with your API keys:
```env
OPENAI_API_KEY="your_openai_api_key"
PUBLIC_URL="your_ngrok_url"  # Will be set after running ngrok
TAVILY_API_KEY="your_tavily_api_key"  # Get from tavily.com
```

### 3. Set Up Twilio
1. Create a Twilio account at https://www.twilio.com
2. Purchase a phone number with Voice capabilities
3. Note your Account SID and Auth Token

### 4. Start the Server
```bash
# Terminal 1: Start the websocket server
cd websocket-server
npm start

# Terminal 2: Start ngrok
ngrok http 8081
```

### 5. Configure Twilio Phone Number
1. Copy the ngrok URL (e.g., https://xxxx.ngrok-free.app)
2. Update PUBLIC_URL in your .env file with this URL
3. Restart your server
4. In Twilio Console, configure your phone number:
   - Voice Configuration → Configure With: Webhooks
   - When a call comes in: `https://your-ngrok-url.ngrok-free.app/twiml`
   - HTTP Method: POST

### 6. Test Your Integration
Call your Twilio phone number and you should be connected to your AI assistant!

## What's Integrated

### Tools Available
1. **Add Function**: Simple math operations
2. **Tavily Search**: Web search for Siegburg city information
3. **Weather Function**: Get weather by coordinates

### System Prompt
The bot is configured as the Siegburg city multilingual voice assistant with:
- Authority to speak as city administration
- Voice-optimized responses
- Automatic language detection and response
- Professional yet approachable tone

## Advanced Integration Options

### Option 1: Direct Tool Integration (Current Setup)
- Tools are defined directly in `functionHandlers.ts`
- Easy to add new tools by following the pattern
- Best for simple integrations

### Option 2: Proxy to Your Original Server
If you want to use your original langchain_openai_voice server:
1. Modify the Twilio server to proxy tool calls to your original server
2. Keep your existing tool implementations
3. Benefits: Reuse existing code, maintain single source of truth

### Option 3: Hybrid Approach
- Keep simple tools in the Twilio server
- Proxy complex operations to your original server
- Best balance of performance and maintainability

## Adding New Tools

To add a new tool, edit `functionHandlers.ts`:

```typescript
functions.push({
  schema: {
    name: "your_tool_name",
    type: "function",
    description: "What your tool does",
    parameters: {
      type: "object",
      properties: {
        param1: { type: "string", description: "Parameter description" }
      },
      required: ["param1"]
    }
  },
  handler: async (args: { param1: string }) => {
    // Your tool implementation
    return JSON.stringify({ result: "your result" });
  }
});
```

## Troubleshooting

1. **No audio**: Check that Twilio webhook is configured correctly
2. **Tools not working**: Verify API keys in .env file
3. **Connection drops**: Ensure ngrok is running and URL is updated
4. **Wrong language response**: The system prompt enforces language matching

## Next Steps

1. Add more city-specific tools
2. Implement call logging/analytics
3. Add multi-tenant support for different cities
4. Integrate with your existing databases
