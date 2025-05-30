# Consent Handling System

This document describes the two-phase consent handling system implemented in the voice bot.

## Overview

The system implements a strict separation between consent collection and regular conversation functionality. When a call starts, only consent-related functions are available. After consent is handled, these are replaced with the full suite of city service functions.

## Two-Phase Architecture

### Phase 1: Consent Collection
- **Available Functions**: Only 3 consent-related functions
  - `hang_up_call` - For explicit consent denial
  - `continue_with_consent` - For explicit consent agreement  
  - `clarify_consent` - For unclear/ambiguous responses
- **System Prompt**: `SYSTEM_PROMPT_WITH_CONSENT` containing consent handling instructions
- **Purpose**: Ensure proper consent before recording the conversation

### Phase 2: Regular Conversation
- **Available Functions**: All service functions
  - `handle_pii_statement` - PII detection and warning
  - `tavily_search` - City service information search
  - `get_weather_from_coords` - Weather information
- **System Prompt**: `SYSTEM_PROMPT_BASE` without any consent references
- **Purpose**: Provide city administration assistance

## Implementation Flow

1. **Call Start**
   - Pre-recorded consent message plays to caller
   - AI receives empty initial greeting to start listening
   - Only consent functions are loaded
   - System prompt includes consent handling instructions

2. **User Response Processing**
   - **Clear "NEIN"/"NO"**: Invoke `hang_up_call` → Play denial message → End call
   - **Clear "JA"/"YES"**: Invoke `continue_with_consent` → Proceed to Phase 2
   - **Unclear/Questions**: Invoke `clarify_consent` → Ask for clear yes/no

3. **Transition to Phase 2**
   - After ANY consent function is invoked:
     - All consent functions are removed
     - All service functions are added
     - System prompt switches to base version
     - Normal conversation begins
   - **Recording behavior**:
     - If `continue_with_consent` is called: Recording starts immediately
     - If `hang_up_call` is called: No recording occurs, call ends
     - If `clarify_consent` is called: Recording remains delayed

## Key Features

### Recording Integration
- **With consent handling**: Recording only starts after explicit consent via `continue_with_consent`
- **Without consent handling**: Recording starts immediately when call begins
- **Privacy compliance**: No audio is recorded until consent is granted

### Automatic Function Swapping
```typescript
// Phase 1: Only consent functions
const consentFunctions = getOnlyConsentFunctions();

// After consent handling
const nonConsentFunctions = getNonConsentFunctions();
```

### Dynamic Prompt Switching
```typescript
// Initial setup
instructions: SYSTEM_PROMPT_WITH_CONSENT

// After consent
instructions: SYSTEM_PROMPT_BASE
```

### Session State Tracking
- `sessionControl.consentHandled`: Tracks if consent has been processed
- `sessionControl.shouldUpdateFunctions`: Triggers the function swap
- Session-specific tracking ensures multiple concurrent calls work correctly

## Benefits

1. **Clear Separation**: No mixing of consent and service functionality
2. **Compliance**: Ensures consent is properly obtained before recording
3. **User Experience**: No confusion about consent after initial handling
4. **Clean State**: AI doesn't see consent instructions after Phase 1

## Configuration

The consent functions and prompts are defined in:
- `/websocket-server/src/functionHandlers.ts` - Function definitions
- `/websocket-server/src/systemPrompt.ts` - Prompt configurations
- `/websocket-server/src/sessionManager.ts` - Phase transition logic

### Disabling Consent Handling

You can disable the consent handling phase entirely by setting the environment variable:

```bash
DISABLE_CONSENT_HANDLING=true
```

When this is set:
1. The consent phase is skipped entirely
2. All service functions are available from the start
3. The system uses `SYSTEM_PROMPT_BASE` immediately
4. The initial greeting is sent directly ("Guten Tag! Hier ist die Stadt Siegburg. Wie kann ich Ihnen helfen?")
5. No pre-recorded consent message is played (TwiML excludes the `<Play>` element)
6. Consent denial audio is not preloaded

**Note**: By default, consent handling is ENABLED. The system is designed to be opt-out for compliance reasons.

## Testing

### With Consent Handling (Default)
1. Start a call - only consent functions should be available
2. Say "was?" - should trigger clarification
3. Say "ja" - should transition to service functions
4. Verify consent functions are no longer available
5. Verify service functions now work correctly

### Without Consent Handling
1. Set `DISABLE_CONSENT_HANDLING=true` in environment
2. Start a call - all service functions should be available immediately
3. Verify proper greeting is sent
4. Verify no consent functions are available
5. Verify normal conversation works from the start

**Note**: By default, consent handling is enabled (opt-in behavior). Only set this variable to `true` if you're handling consent through other means or don't require consent for recording.

## Testing

### Testing with Consent Handling (Default)
To test the consent flow:
1. Start a call - only consent functions should be available
2. Say "was?" - should trigger clarification
3. Say "ja" - should transition to service functions
4. Verify consent functions are no longer available
5. Verify service functions now work correctly

### Testing without Consent Handling
To test with consent disabled:
1. Set `DISABLE_CONSENT_HANDLING=true` in your `.env` file
2. Start a call - all service functions should be available immediately
3. Verify the AI greets you directly
4. Verify you can use service functions right away
5. Verify no consent-related functions are available