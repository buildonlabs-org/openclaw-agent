# OpenAI Auto-Configuration

## Overview

Every agent that launches can be automatically configured with default OpenAI credentials and model settings by setting Railway environment variables:

- **API Key**: Set via `DEFAULT_OPENAI_API_KEY` environment variable
- **Model**: Set via `DEFAULT_MODEL` environment variable (defaults to `gpt-4o-mini`)

## Railway Setup

To enable auto-configuration, add these environment variables in Railway:

1. Go to your Railway project settings
2. Navigate to **Variables** tab
3. Add:
   - `DEFAULT_OPENAI_API_KEY` = `your-openai-api-key-here`
   - `DEFAULT_MODEL` = `gpt-4o-mini` (or any other model)

## Changes Made

### 1. Environment Variable Setup (`start.sh`)

Added automatic export of OpenAI credentials at startup:

```bash
# Auto-configure OpenAI defaults for all agents
# Set DEFAULT_OPENAI_API_KEY in Railway environment variables
if [ -n "$DEFAULT_OPENAI_API_KEY" ]; then
    export OPENAI_API_KEY="${OPENAI_API_KEY:-$DEFAULT_OPENAI_API_KEY}"
fi
export DEFAULT_MODEL="${DEFAULT_MODEL:-gpt-4o-mini}"
```

### 2. Server Configuration (`src/server.js`)

#### Constants Defined
```javascript
// Auto-configure OpenAI defaults for all agents
// Set DEFAULT_OPENAI_API_KEY in Railway environment variables
const DEFAULT_OPENAI_KEY = process.env.DEFAULT_OPENAI_API_KEY?.trim();
const DEFAULT_MODEL = process.env.DEFAULT_MODEL?.trim() || "gpt-4o-mini";

// Set OpenAI API key in environment if not already set
if (!process.env.OPENAI_API_KEY && DEFAULT_OPENAI_KEY) {
  process.env.OPENAI_API_KEY = DEFAULT_OPENAI_KEY;
  console.log("[autoconfigure] Set default OPENAI_API_KEY from DEFAULT_OPENAI_API_KEY env var");
}
```

#### Updated `buildOnboardArgs()` Function
- Now defaults to `openai-api-key` auth choice if none specified
- Automatically uses `DEFAULT_OPENAI_KEY` if no API key is provided
- Ensures all agents have OpenAI credentials during onboarding

```javascript
// Default to OpenAI if no auth choice specified
const authChoice = payload.authChoice || "openai-api-key";
args.push("--auth-choice", authChoice);

// Use provided secret, or fallback to default OpenAI key
const secretValue = secret || (authChoice === "openai-api-key" ? DEFAULT_OPENAI_KEY : "");
```

#### Updated Model Configuration (2 locations)
Both the `/setup/api/run` and `/api/configure` endpoints now:
- Default to `gpt-4o-mini` if no model is specified
- Always set a model during agent configuration

```javascript
// Set model (use provided model or default to gpt-4o-mini)
const modelToSet = payload.model?.trim() || DEFAULT_MODEL;
```

### 3. Documentation (`README.md`)

Added feature highlight:
```markdown
- 🎯 **Default OpenAI Setup** - Pre-configured with OpenAI API key and gpt-4o-mini model
```

## How It Works

### During Agent Launch

1. **Startup Script** (`start.sh`):
   - Exports `OPENAI_API_KEY` environment variable with default key
   - Sets `DEFAULT_MODEL` environment variable to `gpt-4o-mini`
   - These are inherited by all child processes

2. **Server Initialization** (`src/server.js`):
   - Checks if `OPENAI_API_KEY` is set in environment
   - If not set, assigns the default key
   - Logs autoconfiguration status

3. **Agent Onboarding**:
   - When `buildOnboardArgs()` is called:
     - Defaults `authChoice` to `"openai-api-key"` if not specified
     - Uses provided API secret, or falls back to `DEFAULT_OPENAI_KEY`
   - After successful onboarding:
     - Sets model to `payload.model` or `DEFAULT_MODEL` (gpt-4o-mini)

4. **Child Process Spawning**:
   - All OpenClaw CLI commands inherit environment variables via `...process.env`
   - This includes the `OPENAI_API_KEY` set during initialization
   - Gateway process and all commands have access to the credentials

## Override Behavior

You can override or set the defaults by:

1. **Railway Environment Variables** (recommended):
   - `DEFAULT_OPENAI_API_KEY` - Your OpenAI API key
   - `DEFAULT_MODEL` - Model to use (default: gpt-4o-mini)
   - `OPENAI_API_KEY` - Direct override (highest priority)

2. **Setup Wizard** - Provide custom values during `/setup`:
   ```json
   {
     "authChoice": "openai-api-key",
     "authSecret": "your-custom-key",
     "model": "gpt-4-turbo"
   }
   ```

3. **API Configuration** - Use `/api/configure` endpoint:
   ```json
   {
     "authChoice": "openai-api-key",
     "authSecret": "your-custom-key",
     "model": "gpt-4-turbo"
   }
   ```

## Benefits

✅ **Simplified Setup** - Set once in Railway, all agents use it
✅ **Secure** - API keys stored as environment variables, not in code
✅ **Automatic Fallback** - If DEFAULT_OPENAI_API_KEY is set, it's automatically used
✅ **Easy Override** - Can be customized per agent via setup wizard or API
✅ **Consistent Behavior** - All agents use same defaults unless specified
✅ **Cost Effective** - Uses `gpt-4o-mini` by default for lower costs

## Testing

To verify the auto-configuration:
Set `DEFAULT_OPENAI_API_KEY` in Railway environment variables
2. Deploy the agent
3. Check startup logs for: `[autoconfigure] Set default OPENAI_API_KEY from DEFAULT_OPENAI_API_KEY env var`
4. Check startup logs for: `[autoconfigure] Default model: gpt-4o-mini`
5. Run setup wizard without providing API key - should succeed using defaults
6. Run setup wizard without providing API key - should succeed
5. Agent should respond to chat messages using OpenAI

## Impact

- **Existing Agents**: Will continue working as before (env vars take precedence)
- **New Agents**: Automatically configured with defaults
- **Setup Process**: Simplified - no need to manually input OpenAI credentials
- **API Usage**: `/api/configure` and `/setup/api/run` work without credentials

## Files Modified

1. `/workspaces/openclaw-agent/start.sh` - Added environment variable exports
2. `/workspaces/openclaw-agent/src/server.js` - Added auto-configuration logic
3. `/workspaces/openclaw-agent/README.md` - Updated feature list
