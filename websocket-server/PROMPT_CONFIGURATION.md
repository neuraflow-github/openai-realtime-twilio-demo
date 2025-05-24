# Voice Assistant Prompt Configuration Guide

## Quick Start

To modify the voice assistant's behavior, edit the file: `src/systemPrompt.ts`

## Configuration Options

### 1. System Prompt
The main instructions that define your assistant's personality and behavior.

```typescript
export const SYSTEM_PROMPT = `Your custom prompt here...`;
```

**Tips for writing a good voice prompt:**
- Keep instructions clear and concise
- Optimize for spoken language (avoid complex formatting)
- Consider the conversation flow
- Include language requirements if needed
- Define the assistant's role and authority level

### 2. Initial Greeting
Configure whether the assistant should greet users automatically:

```typescript
export const INITIAL_GREETING = {
  enabled: true,                          // Set to false to disable
  message: "Say a brief greeting",        // The instruction for the greeting
  delayMs: 1000                          // Delay before greeting (milliseconds)
};
```

### 3. Voice Settings
Choose the assistant's voice:

```typescript
export const VOICE_CONFIG = {
  voice: "ash",    // Options: "alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "ballad", "coral", "sage", "verse"
  speed: 1.0       // Speed of speech (0.25 to 4.0)
};
```

### 4. Conversation Settings
Additional conversation parameters:

```typescript
export const CONVERSATION_CONFIG = {
  maxConversationDurationMs: 10 * 60 * 1000,  // Maximum conversation duration
  enableTranscription: true,                   // Enable/disable transcription
  transcriptionModel: "whisper-1"              // Transcription model to use
};
```

## Examples

### Example 1: Customer Service Bot
```typescript
export const SYSTEM_PROMPT = `You are a friendly customer service representative for ACME Corp. 
Help customers with their inquiries about products, orders, and support issues.
Always be polite, professional, and solution-oriented.
If you don't know something, offer to connect them with a human agent.`;
```

### Example 2: Restaurant Reservation Assistant
```typescript
export const SYSTEM_PROMPT = `You are the reservation assistant for The Blue Elephant restaurant.
Help customers make, modify, or cancel reservations.
Always confirm the date, time, and number of guests.
Mention any special requirements or dietary restrictions.`;
```

### Example 3: Multi-lingual Assistant
```typescript
export const SYSTEM_PROMPT = `You are a multi-lingual virtual assistant.
IMPORTANT: Always respond in the same language the user speaks to you.
Provide helpful information and assistance with various tasks.
Be concise and clear in your responses.`;
```

## Best Practices

1. **Test your prompts** - Make test calls to ensure the assistant behaves as expected
2. **Keep it natural** - Write prompts that encourage natural conversation
3. **Be specific** - Clear instructions lead to consistent behavior
4. **Consider edge cases** - Think about how the assistant should handle unexpected inputs
5. **Iterate** - Refine your prompt based on real usage

## Advanced Configuration

For runtime configuration, you can also pass custom instructions via the WebSocket session update:

```javascript
{
  type: "session.update",
  session: {
    instructions: "Custom instructions for this session only",
    voice: "nova"  // Override voice for this session
  }
}
```

This will override the default configuration in `systemPrompt.ts` for that specific session.