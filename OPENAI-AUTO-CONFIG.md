# OpenAI Auto-Configuration

## Overview

Agents automatically configure themselves on startup when the `DEFAULT_OPENAI_API_KEY` environment variable is set in Railway. No manual setup required!

- **API Key**: Set via `DEFAULT_OPENAI_API_KEY` environment variable
- **Model**: Set via `DEFAULT_MODEL` environment variable (defaults to `gpt-4o-mini`)
- **Auto-Onboarding**: Runs automatically on first startup if not configured

## Quick Start

1. Deploy to Railway
2. Add environment variable: `DEFAULT_OPENAI_API_KEY` = `your-api-key`
3. Redeploy or restart the service
4. **Done!** Agent auto-configures and starts working immediately

No need to visit `/setup` or call any API endpoints.

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
   - Exports `OPENAI_API_KEY` environment variable if `DEFAULT_OPENAI_API_KEY` is set
   - Sets `DEFAULT_MODEL` environment variable to `gpt-4o-mini`
   - These are inherited by all child processes

2. **Server Initialization** (`src/server.js`):
   - Checks if `OPENAI_API_KEY` is set in environment
   - If not set but `DEFAULT_OPENAI_API_KEY` exists, assigns the default key
   - Logs autoconfiguration status

3. **Auto-Onboarding on Startup**:
   - **If already configured**: Starts gateway normally
   - **If NOT configured BUT `DEFAULT_OPENAI_API_KEY` is set**:
     - Automatically runs onboarding with default credentials
     - Configures gateway settings
     - Sets model to `gpt-4o-mini`
     - Starts the gateway
     - Agent becomes fully operational without any manual intervention!
   - **If NOT configured AND no `DEFAULT_OPENAI_API_KEY`**:
     - Waits for manual setup via `/setup` wizard

4. **Logs to Watch For**:
   ```
   [wrapper] AUTO-ONBOARDING: Not configured but DEFAULT_OPENAI_KEY is set
   [wrapper] AUTO-ONBOARDING: Running automatic setup with default credentials...
   [wrapper] AUTO-ONBOARDING: Starting onboarding with default OpenAI credentials...
   [wrapper] AUTO-ONBOARDING: Configuring gateway settings...
   [wrapper] AUTO-ONBOARDING: Setting model to gpt-4o-mini...
   [wrapper] AUTO-ONBOARDING: Starting gateway...
   [wrapper] AUTO-ONBOARDING: ✅ Agent fully configured and ready!
   ```

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

✅ **Zero Manual Configuration** - Set env var once, all new agents auto-configure
✅ **Instant Deployment** - No need to visit setup wizard or call API endpoints
✅ **Secure** - API keys stored as environment variables, not in code
✅ **Automatic On Startup** - Onboarding runs automatically when needed
✅ **Easy Override** - Can still customize per agent via setup wizard or API
✅ **Consistent Behavior** - All agents use same defaults unless specified
✅ **Cost Effective** - Uses `gpt-4o-mini` by default for lower costs
✅ **Production Ready** - Fully automated deployment pipeline

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

- **New Agents**: Fully automated - set env var and deploy, that's it!
- **Existing Agents**: Continue working as before (already configured)
- **Manual Setup**: Still available via `/setup` wizard if needed
- **Fresh Deployments**: Auto-configure on first startup without any intervention

## Files Modified

1. `/workspaces/openclaw-agent/start.sh` - Added environment variable exports
2. `/workspaces/openclaw-agent/src/server.js` - Added auto-configuration and auto-onboarding logic
3. `/workspaces/openclaw-agent/README.md` - Updated feature list

## Example: Fully Automated Agent Deployment

```bash
# 1. Set in Railway (one time)
DEFAULT_OPENAI_API_KEY=sk-proj-YOUR-KEY-HERE
DEFAULT_MODEL=gpt-4o-mini

# 2. Deploy
git push

# 3. Done! ✅
# Agent auto-configures, starts gateway, and is ready to chat
# No setup wizard, no API calls, no manual intervention
```
