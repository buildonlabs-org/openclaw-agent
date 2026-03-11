# OpenClaw Agent Headless API

## Overview

The OpenClaw agent wrapper exposes a REST API for headless operation. This API is designed for **setup, monitoring, and management** - not for day-to-day interaction.

### API vs Conversational Interaction

**Use the API for:**
- ✅ Initial configuration and setup
- ✅ Status monitoring and health checks
- ✅ Log retrieval and diagnostics
- ✅ Pairing approval (DM access control)
- ✅ Programmatic bulk operations
- ✅ **WebSocket chat** (for custom web dashboards)

**Use Telegram/Discord for:**
- 💬 Installing, updating, removing skills
- 💬 Chatting with the agent (mobile users)
- 💬 Asking questions, running tasks
- 💬 Natural error handling and feedback

**Why conversational is better for skills:**
- No rate limit issues - agent handles retries naturally
- Better UX - "install polymarket skill" vs API calls
- Agent can search, suggest, and explain skills
- Error messages are helpful, not JSON
- Users are already in Telegram/Discord anyway

**Example workflow:**
```bash
# Setup (API)
curl -X POST /api/configure -d '{"telegramToken": "..."}'

# Monitor (API)
curl /api/status

# Chat (WebSocket for web dashboards)
const ws = new WebSocket('ws://localhost:8080/gateway?token=GATEWAY_TOKEN');
ws.send(JSON.stringify({type: "message", content: "Hello!", sessionId: "user-123"}));

# Or Chat (Telegram/Discord for end-users)
User on Telegram: "Install the postgres backup skill"
Agent: "Installing postgres-backup@1.2.0..."
```

## Authentication

All API endpoints require bearer token authentication:

```bash
Authorization: Bearer <WRAPPER_API_KEY>
```

### API Key Options

1. **Custom API Key** (recommended): Set `WRAPPER_API_KEY` environment variable
2. **Gateway Token** (fallback): Uses `OPENCLAW_GATEWAY_TOKEN` if `WRAPPER_API_KEY` not set

```bash
# Railway/Docker deployment
WRAPPER_API_KEY=your-secure-api-key-here
```

## API Endpoints

### 1. Get Status

**`GET /api/status`**

Returns current configuration and gateway status.

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/status
```

**Response:**
```json
{
  "ok": true,
  "configured": true,
  "openclawVersion": "1.2.3",
  "gateway": {
    "running": true,
    "starting": false,
    "reachable": true,
    "pid": 12345,
    "target": "http://127.0.0.1:18789",
    "token": "gw_abc123def456..."
  },
  "stateDir": "/data/.openclaw",
  "workspaceDir": "/data/workspace"
}
```

**Frontend Usage:**
- Poll this endpoint to show agent status in your dashboard
- Display `openclawVersion`, `gateway.running`, `gateway.reachable`
- Show "Starting..." if `gateway.starting` is true
- Show "Not Configured" if `configured` is false
- Use `gateway.token` for WebSocket connections to `/gateway`

---

### 2. Configure Agent

**`POST /api/configure`**

Idempotent configuration endpoint. Creates new configuration or returns success if already configured.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "flow": "quickstart",
    "authChoice": "openai-api-key",
    "authSecret": "sk-...",
    "model": "gpt-4",
    "telegramToken": "123456:ABC...",
    "discordToken": "MTk..."
  }' \
  https://your-agent.railway.app/api/configure
```

**Request Body (Standard Format):**
```typescript
{
  flow?: "quickstart" | "advanced" | "manual";     // Default: "quickstart"
  authChoice: "openai-api-key" | "apiKey" | "gemini-api-key" | "openrouter-api-key";
  authSecret: string;                               // Provider API key
  model?: string;                                   // e.g., "gpt-4", "claude-3-opus"
  telegramToken?: string;                           // Optional Telegram bot token
  discordToken?: string;                            // Optional Discord bot token
}
```

**Request Body (Alternative - Shorthand):**
```typescript
{
  provider: "openai" | "anthropic" | "google" | "gemini" | "openrouter"; // Auto-mapped to authChoice
  apiKey: string;                                   // Auto-mapped to authSecret
  model?: string;                                   // Model name (auto-prefixed with provider)
  telegramToken?: string;                           // Optional Telegram bot token
  discordToken?: string;                            // Optional Discord bot token
}
```

**Auth Choice Mapping:**
- `"openai-api-key"` → OpenAI (shorthand: `provider: "openai"`)
- `"apiKey"` → Anthropic Claude (shorthand: `provider: "anthropic"`)
- `"gemini-api-key"` → Google Gemini (shorthand: `provider: "google"` or `"gemini"`)
- `"openrouter-api-key"` → OpenRouter (shorthand: `provider: "openrouter"`)

**Model Name Format:**
- Simple name: `"gpt-4-turbo"` (auto-prefixed with provider: `openai/gpt-4-turbo`)
- Fully-qualified: `"openai/gpt-4-turbo"` (used as-is)
- **Recommendation:** Use fully-qualified names to avoid ambiguity
- **Important:** Model must exist in OpenClaw's catalog (check with `GET /api/models`)

**Response (Success):**
```json
{
  "ok": true,
  "output": "[setup] Onboarding exit=0...\n[config] gateway started.\n"
}
```

**Response (Already Configured):**
```json
{
  "ok": true,
  "output": "Already configured. Gateway is running.\nUse POST /api/reset to reconfigure.\n",
  "alreadyConfigured": true
}
```

**💡 Tip:** If you need to update just the Telegram or Discord token without reconfiguring everything, use `POST /api/channels/update` instead (see Section 5b). This avoids having to re-enter your LLM API key.

**Response (Error):**
```json
{
  "ok": false,
  "output": "Invalid authChoice: invalid-provider"
}
```

**Frontend Usage:**
- Show configuration form with provider selection (dropdown)
- Map provider selection to correct `authChoice` value
- Support optional Telegram/Discord bot tokens
- Show progress/loading during configuration (can take 30-60s)
- Parse `output` to display detailed logs
- Check `alreadyConfigured` to show "Edit" vs "Create" flow

---

### 3. Get Logs

**`GET /api/logs?tail=200`**

Retrieve recent gateway logs.

**Query Parameters:**
- `tail` (optional): Number of lines to retrieve (default: 100)

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/logs?tail=200
```

**Response:**
```json
{
  "ok": true,
  "logs": "[2026-02-26T10:15:30Z] [gateway] started\n[telegram] connected\n...",
  "logPath": "/tmp/openclaw/openclaw-2026-02-26.log",
  "status": {
    "hasTelegram": true,
    "hasDiscord": false,
    "hasErrors": false
  }
}
```

**Frontend Usage:**
- Display logs in a scrollable terminal/console widget
- Show `status` badges: "Telegram Connected", "Discord Connected", "Has Errors"
- Auto-refresh logs every 5-10 seconds for live monitoring
- Add filtering/search capability for large logs

---

### 4. Run Doctor

**`POST /api/doctor`**

Run diagnostics and automatic repairs on the gateway configuration.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/doctor
```

**Response:**
```json
{
  "ok": true,
  "output": "✓ Gateway configuration valid\n✓ API keys verified\n",
  "exitCode": 0
}
```

**Frontend Usage:**
- Offer as "Fix Issues" or "Run Diagnostics" button
- Show `output` in a modal or dedicated diagnostics panel
- Display success/error based on `ok` and `exitCode`
- Suggest running doctor when errors are detected in logs

---

### 5. Reset Configuration

**`POST /api/reset`**

Delete configuration and stop the gateway. Use before reconfiguring.

**Important:** This endpoint now returns your current provider and model configuration, so you don't need to re-enter them when reconfiguring (you'll still need to provide your API key again for security).

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/reset
```

**Response:**
```json
{
  "ok": true,
  "message": "Configuration deleted. Gateway stopped. Use POST /api/configure to set up again.",
  "previousConfig": {
    "provider": "openai",
    "model": "gpt-4",
    "hint": "Save these values to avoid re-entering them during reconfiguration. You'll still need to provide your API key again."
  }
}
```

**Frontend Usage:**
- Show as "Reset" or "Delete Configuration" action with confirmation dialog
- **Save `previousConfig` values** and auto-populate them in the reconfiguration form
- After reset, redirect user to configuration form with pre-filled provider and model
- Disable action if agent is not configured

---

### 5a. Get Current Configuration

**`GET /api/config/current`**

Get the current configuration (provider, model, channels) without resetting. Useful for displaying current settings or preparing to update channels.

**Use Case:** Before updating just the Telegram/Discord token, fetch current config to see what's configured. Tokens are not returned for security.

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/config/current
```

**Response:**
```json
{
  "ok": true,
  "config": {
    "provider": "openai",
    "model": "gpt-4",
    "telegram": {
      "enabled": true,
      "dmPolicy": "pairing",
      "hasToken": true
    },
    "discord": null
  },
  "hint": "Use this data to avoid re-entering API keys when reconfiguring. Note: tokens are not returned for security."
}
```

**Frontend Usage:**
- Display current settings in a dashboard or settings page
- Show which channels are configured (without exposing tokens)
- Use `hasToken: true` to indicate a token is set
- Allow users to see their config before making changes

---

### 5b. Update Channels Only

**`POST /api/channels/update`**

Update Telegram or Discord channel configuration **without** reconfiguring the entire agent. This allows you to change bot tokens without re-entering your LLM API key.

**Use Case:** User wants to switch Telegram bots or add a Discord bot without touching their LLM configuration.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "telegram": {
      "enabled": true,
      "token": "123456:ABC-new-token",
      "dmPolicy": "pairing",
      "groupPolicy": "allowlist"
    }
  }' \
  https://your-agent.railway.app/api/channels/update
```

**Request Body:**
```typescript
{
  telegram?: {
    enabled?: boolean;       // Default: true
    token: string;           // Required: New bot token
    dmPolicy?: string;       // Default: "pairing"
    groupPolicy?: string;    // Default: "allowlist"
    streamMode?: string;     // Default: "partial"
  };
  discord?: {
    enabled?: boolean;       // Default: true
    token: string;           // Required: New bot token
    dmPolicy?: string;       // Default: "pairing"
    groupPolicy?: string;    // Default: "allowlist"
  };
}
```

**Response:**
```json
{
  "ok": true,
  "output": "Telegram config updated (exit=0)\n\nRestarting gateway...\nGateway restarted successfully\n",
  "message": "Channel configuration updated successfully"
}
```

**Frontend Usage:**
- Add "Update Telegram Token" or "Update Discord Token" buttons in settings
- Show a form with just the token field (no need to ask for LLM API key again)
- After update, gateway restarts automatically to apply changes
- Display success message and confirm channel is working

**Example Flow:**
1. User clicks "Update Telegram Bot"
2. Frontend shows a simple form: "Enter new Telegram bot token:"
3. Call `POST /api/channels/update` with new token
4. Gateway restarts with new token
5. Done! LLM config unchanged.

---

### 6. List Pairing Requests

**`GET /api/pairing?channel=telegram`**

List pending DM pairing requests from Telegram/Discord users.

**Query Parameters:**
- `channel` (optional): Filter by `telegram` or `discord`

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/pairing?channel=telegram
```

**Response:**
```json
{
  "ok": true,
  "output": "abc123 telegram\nxyz789 discord\n",
  "pending": [
    {
      "code": "abc123",
      "channel": "telegram",
      "info": "abc123 telegram @username"
    },
    {
      "code": "xyz789",
      "channel": "discord",
      "info": "xyz789 discord User#1234"
    }
  ],
  "count": 2
}
```

**Frontend Usage:**
- Show table of pending pairing requests
- Display `code`, `channel`, and user info from `pending` array
- Auto-refresh every 10-15 seconds to catch new requests
- Show empty state when `count` is 0

---

### 7. Approve Pairing

**`POST /api/pairing/approve`**

Approve a user's DM pairing request.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "telegram",
    "code": "abc123"
  }' \
  https://your-agent.railway.app/api/pairing/approve
```

**Request Body:**
```typescript
{
  channel: "telegram" | "discord";
  code: string;                      // Pairing code from /api/pairing
}
```

**Response (Success):**
```json
{
  "ok": true,
  "output": "Pairing approved for telegram abc123\n",
  "exitCode": 0
}
```

**Response (Error):**
```json
{
  "ok": false,
  "output": "Pairing code not found or expired\n",
  "exitCode": 1
}
```

**Frontend Usage:**
- Add "Approve" button next to each pending request
- Show success/error toast based on response
- Remove from list on success (or refresh the list)
- Handle expired codes gracefully

---

### 8. List Devices

**`GET /api/devices`**

List pending device pairing requests (for launcher apps, not DM pairing).

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/devices
```

**Response:**
```json
{
  "success": true,
  "devices": [
    {
      "requestId": "a1b2c3d4e5f6",
      "status": "pending",
      "info": "pending device request a1b2c3d4e5f6"
    }
  ]
}
```

**Frontend Usage:**
- Similar to pairing list, show table of device requests
- Display `requestId` and `status`
- Provide approve action for each device

---

### 9. Approve Device

**`POST /api/devices/approve`**

Approve a device pairing request.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"requestId": "a1b2c3d4e5f6"}' \
  https://your-agent.railway.app/api/devices/approve
```

**Request Body:**
```typescript
{
  requestId: string;
}
```

**Response:**
```json
{
  "success": true,
  "message": "Device a1b2c3d4e5f6 approved",
  "output": "Device approved successfully\n"
}
```

**Frontend Usage:**
- Add approve button for each device
- Show confirmation before approving
- Refresh device list after approval

---

### 10. Check Device Pairing Status

**`GET /api/devices/status`**

Check the device pairing status for this backend instance. Useful for troubleshooting skill installation issues.

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/devices/status
```

**Response:**
```json
{
  "ok": true,
  "deviceId": "a1b2c3d4e5f6789abc...",
  "deviceIdPersisted": true,
  "pairingRequired": false,
  "stateDir": "/data/.openclaw",
  "help": {
    "message": "Device pairing status OK",
    "commands": [
      "openclaw devices list",
      "openclaw devices approve <requestId>"
    ],
    "apiEndpoints": {
      "listDevices": "GET /api/devices",
      "approveDevice": "POST /api/devices/approve {requestId: \"...\"}"
    }
  }
}
```

**Response when pairing required:**
```json
{
  "ok": true,
  "deviceId": "a1b2c3d4e5f6789abc...",
  "deviceIdPersisted": true,
  "pairingRequired": true,
  "stateDir": "/data/.openclaw",
  "help": {
    "message": "Device pairing is required. Use 'openclaw devices list' to find the request ID, then 'openclaw devices approve <requestId>' to approve.",
    "commands": [
      "openclaw devices list",
      "openclaw devices approve <requestId>"
    ]
  }
}
```

**Use Cases:**
- Troubleshooting skill installation failures
- Verifying device persistence across redeployments
- Checking if approval is needed before attempting privileged operations

---

## 11. List Skills

**`GET /api/skills`**

List all installed skills in the agent's workspace.

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/skills
```

**Response:**
```json
{
  "ok": true,
  "skills": [
    {
      "slug": "postgres-backup",
      "version": "1.2.0",
      "raw": "postgres-backup@1.2.0"
    },
    {
      "slug": "calendar-sync",
      "version": "2.0.1",
      "raw": "calendar-sync@2.0.1"
    }
  ],
  "count": 2,
  "workspaceDir": "/data/workspace",
  "skillsDir": "/data/workspace/skills"
}
```

**Frontend Usage:**
- Display list of installed skills in agent dashboard
- Show skill slug and version
- Provide update/delete actions per skill

---

## 11. Search Skills

**`GET /api/skills/search?q=<query>`**

Search ClawHub registry for available skills. Results are cached for 24 hours.

**Use Case:** Display skill discovery in your frontend. Users can browse available skills, then install them conversationally through Telegram/Discord.

**Query Parameters:**
- `q` (required): Search query string
- `limit` (optional): Maximum number of results (default: 20, max: 100)

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://your-agent.railway.app/api/skills/search?q=postgres&limit=10"
```

**Response:**
```json
{
  "ok": true,
  "query": "postgres",
  "results": [
    {
      "slug": "postgres-backup",
      "name": "Postgres Backup",
      "description": "Automated PostgreSQL backup and recovery",
      "author": "clawhub",
      "version": "1.2.0",
      "tags": ["database", "backup"],
      "package": "postgres-backup",
      "score": 4.523
    },
    {
      "slug": "postgres-monitor",
      "name": "Postgres Monitor",
      "description": "Monitor PostgreSQL database health",
      "author": "community",
      "version": "2.1.5",
      "tags": ["database", "monitoring"],
      "package": "postgres-monitor",
      "score": 4.312
    }
  ],
  "count": 2,
  "cached": false
}
```

**Response Fields:**
- `slug`: Unique package identifier to use for installation
- `name`: Human-readable skill name
- `description`: Skill description with relevance info
- `author`: Skill creator/owner
- `version`: Latest available version
- `tags`: Skill category tags
- `package`: Full package name (same as slug)
- `score`: Relevance score from search

**Installing a Skill:**

**Recommended:** Message your agent conversationally on Telegram/Discord:
```
User: "Install the postgres-backup skill"
Agent: "Installing postgres-backup@1.2.0..."
```

**API method** (for programmatic/bulk installs only):
```bash
# Not recommended for end users - use conversational approach
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug": "postgres-backup"}' \
  https://your-agent.railway.app/api/skills/install
```

**Implementation Details:**
- Uses ClawHub API directly: `https://clawhub.ai/api/v1/search`
- Results cached for 24 hours to respect rate limits
- Falls back to `clawhub` CLI if API is unavailable
- Cached responses include `"cached": true` field

**Frontend Usage:**
- Implement skill discovery/browse interface
- Display search results with descriptions and metadata
- **Instead of "Install" button:** Show "To install, message your agent: 'Install [skill-name]'"
- Provide copy-to-clipboard for skill installation messages
- Real-time search with debouncing (recommended: 500ms)
- Cache is automatic - 24 hour TTL per query
- **Handle duplicate slugs:** Show full name + description + author to help users choose
- Link to Telegram/Discord for actual installation

---

## 12. Install Skill

**`POST /api/skills/install`**

**⚠️ Recommendation:** For better UX, have users install skills conversationally through Telegram/Discord instead:

```
User: "Install the polymarket-agent skill"
Agent: "I'll install polymarket-agent for you..."
```

This avoids rate limits, provides natural error handling, and keeps the workflow conversational.

**API Usage:** This endpoint is primarily for programmatic bulk installations or initial workspace setup.

Install a skill from ClawHub registry.

**Request:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "postgres-backup",
    "version": "1.2.0",
    "force": false
  }' \
  https://your-agent.railway.app/api/skills/install
```

**Request Body:**
```typescript
{
  slug: string;          // Required: Skill slug from ClawHub
  version?: string;      // Optional: Specific version (default: latest)
  force?: boolean;       // Optional: Overwrite if exists (default: false)
  retry?: boolean | number; // Optional: Auto-retry on rate limits (true = 3 retries, number = custom max)
}
```

**Response (Success):**
```json
{
  "ok": true,
  "slug": "postgres-backup",
  "version": "1.2.0",
  "output": "✓ Installed postgres-backup@1.2.0\n",
  "exitCode": 0,
  "attempts": 1
}
```

**Response (Rate Limit - HTTP 429):**
```json
{
  "ok": false,
  "slug": "postgres-backup",
  "version": "latest",
  "output": "- Resolving postgres-backup\n✖ Rate limit exceeded\n",
  "exitCode": 1,
  "error": "Rate limit exceeded",
  "suggestion": "Wait 1-2 minutes and retry, or use {\"retry\": true} in request body for automatic retries"
}
```

**Response (Device Pairing Required - HTTP 403):**
```json
{
  "ok": false,
  "slug": "postgres-backup",
  "error": "Device pairing required",
  "message": "Skill installation requires device approval. Please approve the device pairing request.",
  "deviceId": "a1b2c3d4e5f6789abc...",
  "instructions": {
    "cli": [
      "Run on gateway host:",
      "  openclaw devices list",
      "  openclaw devices approve <requestId>"
    ],
    "api": [
      "Use the API endpoints:",
      "  GET /api/devices - List pending devices",
      "  POST /api/devices/approve - Approve device"
    ],
    "ui": [
      "Or use the web UI:",
      "  Navigate to /setup",
      "  Look for device approval section"
    ]
  }
}
```

**Response (Other Error):**
```json
{
  "ok": false,
  "error": "Skill already exists. Use force=true to overwrite."
}
```

**Rate Limit Handling:**

ClawHub has rate limits on package downloads. For programmatic use:

- **Manual retry:** Wait 1-2 minutes between requests
- **Automatic retry:** Add `"retry": true` for exponential backoff (3 attempts)
- **Better alternative:** Let users install via Telegram/Discord where agent handles retries naturally

**Device Pairing for Skill Installation:**

Skill installation is a **privileged operation** that requires device/node pairing approval (a security feature).

- **First-time setup:** You'll need to approve the device once per deployment
- **Persistent identity:** Device ID is stored in `/data/.openclaw/device.id` and survives redeployments
- **How to approve:**
  1. Check device status: `GET /api/devices/status`
  2. List pending devices: `GET /api/devices`
  3. Approve device: `POST /api/devices/approve`
- **Detailed guide:** See [DEVICE-PAIRING-GUIDE.md](DEVICE-PAIRING-GUIDE.md)

**Frontend Usage:**
- Use API for initial workspace setup or bulk installations
- **Recommended:** Direct users to install skills conversationally through their agent
- Show "Talk to your agent on Telegram to install skills" in UI
- Reserve API installation for admin/automation workflows

---

## 13. Update Skills

**`POST /api/skills/update`**

**⚠️ Recommendation:** Have users update skills conversationally:

```
User: "Update the polymarket-agent skill"
User: "Update all my skills"
```

**API Usage:** For programmatic updates or automated maintenance workflows.

Update one or all installed skills.

**Request (Update Single):**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "postgres-backup",
    "version": "1.3.0",
    "force": false
  }' \
  https://your-agent.railway.app/api/skills/update
```

**Request (Update All):**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"all": true}' \
  https://your-agent.railway.app/api/skills/update
```

**Request Body:**
```typescript
{
  slug?: string;         // Skill to update (if not using all)
  all?: boolean;         // Update all skills
  version?: string;      // Specific version (single skill only)
  force?: boolean;       // Force update even if modified locally
}
```

**Response:**
```json
{
  "ok": true,
  "slug": "postgres-backup",
  "output": "✓ Updated postgres-backup 1.2.0 → 1.3.0\n",
  "exitCode": 0
}
```

**Frontend Usage:**
- Add "Update" button on each skill
- Add "Update All" bulk action button
- Show update progress
- Display old → new version in notification
- **Note:** Agent needs restart to load updated skills

---

## 14. Delete Skill

**`DELETE /api/skills/:slug`**

Remove an installed skill from the workspace.

**Request:**
```bash
curl -X DELETE \
  -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/skills/postgres-backup
```

**Response:**
```json
{
  "ok": true,
  "slug": "postgres-backup",
  "message": "Skill postgres-backup deleted",
  "path": "/data/workspace/skills/postgres-backup"
}
```

**Response (Not Found):**
```json
{
  "ok": false,
  "error": "Skill not found: postgres-backup",
  "path": "/data/workspace/skills/postgres-backup"
}
```

**Frontend Usage:**
- Add "Delete" button with confirmation dialog
- Show success toast after deletion
- Refresh skill list
- **Note:** Agent needs restart to unload deleted skills

---

## 15. Get Channels Status

**`GET /api/channels`**

Get status of configured messaging channels (Telegram, Discord, etc.).

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/channels
```

**Response:**
```json
{
  "ok": true,
  "output": "telegram: connected (@mybot)\ndiscord: disconnected\n",
  "channels": [
    {
      "type": "telegram",
      "status": "connected",
      "info": "@mybot"
    },
    {
      "type": "discord",
      "status": "disconnected",
      "info": null
    }
  ],
  "exitCode": 0
}
```

**Response Fields:**
- `output`: Raw output from `openclaw channels status` command
- `channels`: Parsed array of channel status objects
  - `type`: Channel type (telegram, discord, etc.)
  - `status`: Connection status (connected, disconnected, error)
  - `info`: Additional info (bot username, error message, etc.)
- `exitCode`: Command exit code (0 = success)

**Frontend Usage:**
- Display channel connection status in dashboard
- Show which messaging platforms are active
- Use for troubleshooting connectivity issues
- Poll periodically to monitor channel health

---

## 16. List Models

**`GET /api/models`**

List available AI models configured in OpenClaw.

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/models
```

**Response:**
```json
{
  "ok": true,
  "output": "openai/gpt-4 (8k context)\nopenai/gpt-3.5-turbo (4k context)\nanthropic/claude-3-opus (200k context)\n",
  "models": [
    {
      "provider": "openai",
      "name": "gpt-4",
      "details": "8k context",
      "raw": "openai/gpt-4 (8k context)"
    },
    {
      "provider": "openai",
      "name": "gpt-3.5-turbo",
      "details": "4k context",
      "raw": "openai/gpt-3.5-turbo (4k context)"
    },
    {
      "provider": "anthropic",
      "name": "claude-3-opus",
      "details": "200k context",
      "raw": "anthropic/claude-3-opus (200k context)"
    }
  ],
  "exitCode": 0
}
```

**Response Fields:**
- `output`: Raw output from `openclaw models list` command
- `models`: Parsed array of available models
  - `provider`: Model provider (openai, anthropic, google, etc.)
  - `name`: Model name/identifier
  - `details`: Additional details (context window, capabilities, etc.)
  - `raw`: Original line from command output
- `exitCode`: Command exit code (0 = success)

**Frontend Usage:**
- Display available models in settings/configuration UI
- Show model selection dropdown for users
- Display model capabilities and limitations
- Use for troubleshooting model access issues

---

## 17. Get Configuration

**`GET /api/config?path=<config_path>`**

Get OpenClaw configuration settings.

**Query Parameters:**
- `path` (required): Specific config path to retrieve (e.g., `gateway.port`, `aiProvider`, `models.default`)

**Request:**
```bash
# Get specific config path
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://your-agent.railway.app/api/config?path=gateway.port"

# Get AI provider
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://your-agent.railway.app/api/config?path=aiProvider"
```

**Response:**
```json
{
  "ok": true,
  "output": "18789",
  "config": "18789",
  "path": "gateway.port",
  "exitCode": 0
}
```

**Response Fields:**
- `output`: Raw output from `openclaw config get <path>` command
- `config`: Parsed configuration value (string or JSON object)
- `path`: The config path that was queried
- `exitCode`: Command exit code (0 = success)

**Frontend Usage:**
- Query specific configuration values as needed
- Show gateway settings, AI provider, model preferences, etc.
- Use for debugging configuration issues
- Build dynamic settings UI by querying different paths

---

## 18. List Sessions

**`GET /api/sessions`**

List active conversation sessions.

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/sessions
```

**Response:**
```json
{
  "ok": true,
  "output": "session-abc123 telegram @user1 active\nsession-xyz789 discord User#1234 idle\n",
  "sessions": [
    {
      "id": "session-abc123",
      "raw": "session-abc123 telegram @user1 active"
    },
    {
      "id": "session-xyz789",
      "raw": "session-xyz789 discord User#1234 idle"
    }
  ],
  "count": 2,
  "exitCode": 0
}
```

**Response Fields:**
- `output`: Raw output from `openclaw sessions` command
- `sessions`: Parsed array of active sessions
  - `id`: Session identifier
  - `raw`: Full session information line
- `count`: Number of active sessions
- `exitCode`: Command exit code (0 = success)

**Frontend Usage:**
- Display active conversations in dashboard
- Show which users are currently chatting with agent
- Monitor session activity for analytics
- Use for debugging conversation state issues

---

## 19. Chat with Agent (HTTP)

**`POST /api/chat`**

Send a message to your agent and receive a response via HTTP. This uses a persistent WebSocket connection in the background for efficient communication.

**Headers:**
- `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "message": "Hello, what can you help me with?",
  "agentId": "main",        // Optional: defaults to "main"
  "sessionKey": "user-123"  // Optional: maintains conversation context
}
```

**Response (200 OK):**
```json
{
  "ok": true,
  "agentId": "main",
  "sessionKey": "user-123",
  "response": "Hello! I'm your AI agent. I can help you with...",
  "timestamp": "2026-02-28T10:30:00.000Z"
}
```

**Error Responses:**
- `400` - Missing message field
- `503` - Gateway not ready
- `504` - Gateway timeout or connection closed
- `500` - Server error

**Example Usage:**

```bash
# Bash/cURL
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is the weather today?",
    "sessionKey": "alice-session"
  }' \
  http://localhost:8080/api/chat
```

```javascript
// JavaScript
const response = await fetch('http://localhost:8080/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: 'What is the weather today?',
    sessionKey: 'alice-session'
  })
});

const data = await response.json();
console.log('Agent:', data.response);
```

```python
# Python
import requests

response = requests.post(
    'http://localhost:8080/api/chat',
    headers={'Authorization': 'Bearer YOUR_API_KEY'},
    json={
        'message': 'What is the weather today?',
        'sessionKey': 'alice-session'
    }
)

data = response.json()
print('Agent:', data['response'])
```

**Session Management:**

- **`sessionKey`**: Use the same session key for a conversation thread. Each session maintains its own chat history and context.
- **Auto-generated**: If you don't provide a `sessionKey`, one will be generated automatically (useful for one-off queries).
- **Per-user sessions**: Recommended to use unique session keys per user (e.g., `user-${userId}`).

**Tips:**
- Default timeout is 2 minutes for agent responses
- Responses are streamed internally but returned as complete text via HTTP
- For real-time streaming, use the WebSocket API instead (Section 20)

---

## 20. Chat with Agent (WebSocket)

**`WSS /gateway?token=<GATEWAY_TOKEN>`**

Chat with your agent in real-time via WebSocket connection to the gateway.

**Connection URL:**
```javascript
const gatewayToken = "your-gateway-token"; // From OPENCLAW_GATEWAY_TOKEN
const ws = new WebSocket(`wss://your-agent.railway.app/gateway?token=${gatewayToken}`);

// For local development
const ws = new WebSocket(`ws://localhost:8080/gateway?token=${gatewayToken}`);
```

**Getting the Gateway Token:**

The gateway token is automatically generated during configuration. Retrieve it from the status endpoint:

```bash
# Get the gateway token
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/status | jq -r '.gateway.token'

# Or without jq
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/status
# Look for gateway.token in the response
```

**Authentication Flow:**

The gateway uses **OpenClaw Gateway Protocol v2** with cryptographic challenge-response:

1. Connect to WebSocket with token in query parameter
2. Receive `connect.challenge` event with a nonce from gateway
3. **Sign the challenge**: Create v2 payload (pipe-delimited) and sign with Ed25519 private key:
   - Format: `v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce`
   - Example: `v2|abc123...|cli|cli|operator|operator.read,operator.write,operator.admin|1234567890|gw_token...|nonce-uuid`
4. Send `connect` request with `device.signature`, `device.publicKey`, and other authentication fields
5. Receive `hello-ok` confirmation
6. Send messages normally

**Important**: 
- The gateway requires cryptographic signatures using the **exact v2 payload format** above
- Device ID must be SHA256 hash of the **raw 32-byte Ed25519 public key** (not SPKI DER)
- Public key must be the **raw 32 bytes** (extracted from SPKI DER), not the full DER encoding
- Use the provided `chat-client.js` script which handles all of this automatically

**Quick Start with Chat Client:**

```bash
# Install dependencies (ws package)
npm install ws

# Run the chat client (handles signing automatically)
node chat-client.js
```

The script will:
- Generate an Ed25519 key pair
- Connect to the gateway
- Sign the challenge nonce
- Authenticate and start interactive chat

**Manual Implementation (for custom clients):**

```javascript
// Connect
const gatewayToken = "gw_abc123..."; // From /api/status
const ws = new WebSocket(`ws://localhost:8080/gateway?token=${gatewayToken}`);

let authenticated = false;

ws.onopen = () => {
  console.log('WebSocket opened, waiting for challenge...');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  // Step 1: Respond to connect challenge
  if (data.type === 'event' && data.event === 'connect.challenge') {
    console.log('Received challenge, signing...');
    
    // Generate Ed25519 key pair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    
    // Extract raw Ed25519 public key (32 bytes) from SPKI DER
    const publicKeySpkiDer = publicKey.export({ type: 'spki', format: 'der' });
    const rawPublicKey = publicKeySpkiDer.subarray(publicKeySpkiDer.length - 32);
    const rawPublicKeyB64 = rawPublicKey.toString('base64');
    
    const signedAt = Date.now();
    const nonce = data.payload.nonce;
    
    // Device ID: SHA256 fingerprint of RAW public key (not DER)
    const deviceId = crypto.createHash('sha256').update(rawPublicKey).digest('hex');
    
    const clientId = 'cli';
    const clientMode = 'cli';
    const role = 'operator';
    const scopes = ['operator.read', 'operator.write', 'operator.admin'];
    
    // Build v2 payload: pipe-delimited format required by gateway
    const scopesStr = scopes.join(',');
    const payload = `v2|${deviceId}|${clientId}|${clientMode}|${role}|${scopesStr}|${signedAt}|${gatewayToken}|${nonce}`;
    
    // Sign UTF-8 payload with Ed25519
    const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey);
    
    ws.send(JSON.stringify({
      type: "req",
      id: "c1",
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          version: "0.0.0",
          platform: "macos",
          mode: clientMode
        },
        role,
        scopes,
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: gatewayToken },
        locale: "en-US",
        userAgent: "chat-client",
        device: {
          id: deviceId,
          publicKey: rawPublicKeyB64,      // Base64 of RAW 32-byte key
          signature: signature.toString('base64'),
          signedAt,
          nonce
        }
      }
    }));
  }
  
  // Step 2: Handle hello-ok confirmation
  else if (data.type === 'res' && data.id === 'c1' && data.result?.hello === 'ok') {
    console.log('✓ Connected successfully!');
    authenticated = true;
    
    // Now you can send messages
    ws.send(JSON.stringify({
      type: 'req',
      id: 'm1',
      method: 'operator.message.send',
      params: {
        content: 'Hello, what can you do?',
        sessionId: 'user-123'
      }
    }));
  }
  
  // Step 3: Handle agent responses
  else if (data.type === 'event' && data.event === 'operator.message') {
    console.log('Agent:', data.payload?.content || data);
  }
  
  // Handle method responses
  else if (data.type === 'res') {
    console.log('Response:', data);
  }
  
  // Handle other events
  else {
    console.log('Event:', data);
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from agent gateway');
};
```

**Message Format:**

**Authentication Messages:**
```typescript
// Challenge from gateway (Step 1)
{
  type: "event";
  event: "connect.challenge";
  payload: {
    nonce: string;    // Unique nonce for this connection
    ts: number;       // Timestamp
  };
}

// Your connect request (Step 2)
{
  type: "req";
  id: string;         // Unique request ID (e.g., "c1")
  method: "connect";
  params: {
    minProtocol: 3;
    maxProtocol: 3;
    client: {
      id: string;       // Must be "web-client", "cli-client", etc. (check gateway config)
      version: string;  // Client version
      platform: string; // "web", "terminal", "desktop", etc.
    };
    role: "operator";
    scopes: string[];   // ["operator.read", "operator.write"]
    caps: any[];
    commands: any[];
    permissions: {};
    auth: {
      token: string;    // Your gateway token
    };
  };
}

// Confirmation from gateway (Step 3)
{
  type: "res";
  id: string;         // Echo of your request ID
  result: {
    hello: "ok";
    // ... other connection info
  };
}
```

**Chat Messages (after connection):**

**Sending a message (Client → Agent):**
```typescript
{
  type: "req";
  id: string;                   // Unique request ID (e.g., "m1", "m2")
  method: "operator.message.send";
  params: {
    content: string;            // Your message
    sessionId: string;          // User/session identifier
    metadata?: {                // Optional metadata
      userId?: string;
      conversationId?: string;
      [key: string]: any;
    };
  };
}
```

**Receiving messages (Agent → Client):**
```typescript
{
  type: "event";
  event: "operator.message";
  payload: {
    content: string;            // Agent's response
    sessionId: string;
    timestamp?: number;
    metadata?: {
      model?: string;
      tokensUsed?: number;
      [key: string]: any;
    };
  };
}
}
```

**Full React Example:**

```typescript
import { useEffect, useState, useRef } from 'react';

function AgentChat({ gatewayUrl, gatewayToken, userId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to gateway
    ws.current = new WebSocket(`${gatewayUrl}/gateway?token=${gatewayToken}`);
    
    ws.current.onopen = () => {
      console.log('Connected to agent');
      setConnected(true);
    };
    
    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message') {
        setMessages(prev => [...prev, {
          role: 'agent',
          content: data.content,
          timestamp: Date.now()
        }]);
      }
    };
    
    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnected(false);
    };
    
    ws.current.onclose = () => {
      console.log('Disconnected');
      setConnected(false);
    };
    
    return () => {
      ws.current?.close();
    };
  }, [gatewayUrl, gatewayToken]);
  
  const sendMessage = () => {
    if (!input.trim() || !ws.current || ws.current.readyState !== WebSocket.OPEN) {
      return;
    }
    
    // Add to UI immediately
    setMessages(prev => [...prev, {
      role: 'user',
      content: input,
      timestamp: Date.now()
    }]);
    
    // Send to agent
    ws.current.send(JSON.stringify({
      type: "message",
      content: input,
      sessionId: userId // Critical for conversation context
    }));
    
    setInput('');
  };
  
  return (
    <div className="chat-container">
      <div className="status">
        {connected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>
      
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <strong>{msg.role}:</strong> {msg.content}
          </div>
        ))}
      </div>
      
      <div className="input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message..."
          disabled={!connected}
        />
        <button onClick={sendMessage} disabled={!connected}>
          Send
        </button>
      </div>
    </div>
  );
}
```

**Important Notes:**

- **sessionId is required** - This maintains conversation context across messages
- **Gateway token** is different from `WRAPPER_API_KEY` - it's the OpenClaw gateway auth token
- **Connection is proxied** - The wrapper proxies WebSocket connections to the internal gateway
- **Use for web dashboards** - This is ideal for custom frontends/dashboards
- **Telegram/Discord still recommended** - For end-users, Telegram/Discord provides better mobile experience

**Alternative: Use Telegram/Discord**

For end-users (not developer dashboards), Telegram/Discord is still the recommended approach:

```bash
# Configure with Telegram
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "authChoice": "openai-api-key",
    "authSecret": "sk-...",
    "telegramToken": "123456:ABC..."
  }' \
  https://your-agent.railway.app/api/configure
```

Users can then chat naturally on Telegram/Discord without needing a custom web interface

---

## Environment Variables

### Required
- `SETUP_PASSWORD`: Password for `/setup` wizard access
- `WRAPPER_API_KEY`: Bearer token for API authentication (optional, defaults to gateway token)

### Optional - Skill Management
- `OPENCLAW_DEFAULT_SKILLS`: Comma-separated list of skill slugs to install on first launch
  ```bash
  OPENCLAW_DEFAULT_SKILLS=postgres-backup,calendar-sync,gmail-integration
  ```
- `CLAWHUB_CLI`: Path to clawhub CLI binary (default: `clawhub`)

### Optional - General
- `OPENCLAW_STATE_DIR`: Configuration directory (default: `/data/.openclaw`)
- `OPENCLAW_WORKSPACE_DIR`: Workspace directory (default: `/data/workspace`)
- `INTERNAL_GATEWAY_PORT`: Gateway port (default: `18789`)

---

## Frontend Integration Patterns

### 1. Agent Dashboard Card

```typescript
interface AgentStatus {
  id: string;
  name: string;
  status: 'running' | 'starting' | 'stopped' | 'unconfigured';
  provider: 'openai' | 'anthropic' | 'google' | 'openrouter';
  model: string;
  channels: {
    telegram: boolean;
    discord: boolean;
  };
  apiEndpoint: string;
  apiKey: string;
}

async function getAgentStatus(agent: AgentStatus) {
  const response = await fetch(`${agent.apiEndpoint}/api/status`, {
    headers: {
      'Authorization': `Bearer ${agent.apiKey}`
    }
  });
  return await response.json();
}
```

### 2. Configuration Flow

```typescript
interface ConfigureAgentRequest {
  provider: 'openai' | 'anthropic' | 'google' | 'openrouter';
  apiKey: string;
  model?: string;
  channels?: {
    telegram?: string;  // Bot token
    discord?: string;   // Bot token
  };
}

function mapProviderToAuthChoice(provider: string): string {
  const mapping = {
    'openai': 'openai-api-key',
    'anthropic': 'apiKey',
    'google': 'gemini-api-key',
    'openrouter': 'openrouter-api-key'
  };
  return mapping[provider];
}

async function configureAgent(
  agentEndpoint: string, 
  agentApiKey: string, 
  config: ConfigureAgentRequest
) {
  const response = await fetch(`${agentEndpoint}/api/configure`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agentApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      flow: 'quickstart',
      authChoice: mapProviderToAuthChoice(config.provider),
      authSecret: config.apiKey,
      model: config.model,
      telegramToken: config.channels?.telegram,
      discordToken: config.channels?.discord
    })
  });
  
  return await response.json();
}
```

### 3. Real-time Status Polling

```typescript
function useAgentStatus(agentEndpoint: string, apiKey: string, pollInterval = 5000) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    async function fetchStatus() {
      try {
        const response = await fetch(`${agentEndpoint}/api/status`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const data = await response.json();
        setStatus(data);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    fetchStatus();
    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [agentEndpoint, apiKey, pollInterval]);
  
  return { status, loading, error };
}
```

### 4. Pairing Management

```typescript
async function listPendingPairings(
  agentEndpoint: string, 
  apiKey: string, 
  channel?: 'telegram' | 'discord'
) {
  const url = new URL(`${agentEndpoint}/api/pairing`);
  if (channel) url.searchParams.set('channel', channel);
  
  const response = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  
  const data = await response.json();
  return data.pending || [];
}

async function approvePairing(
  agentEndpoint: string,
  apiKey: string,
  channel: 'telegram' | 'discord',
  code: string
) {
  const response = await fetch(`${agentEndpoint}/api/pairing/approve`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel, code })
  });
  
  return await response.json();
}
```

### 5. Log Viewer Component

```typescript
function AgentLogViewer({ agentEndpoint, apiKey }) {
  const [logs, setLogs] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  useEffect(() => {
    if (!autoRefresh) return;
    
    async function fetchLogs() {
      const response = await fetch(
        `${agentEndpoint}/api/logs?tail=200`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } }
      );
      const data = await response.json();
      if (data.ok) {
        setLogs(data.logs);
      }
    }
    
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [agentEndpoint, apiKey, autoRefresh]);
  
  return (
    <div className="log-viewer">
      <div className="controls">
        <label>
          <input 
            type="checkbox" 
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh
        </label>
      </div>
      <pre className="logs">{logs}</pre>
    </div>
  );
}
```

### 6. Skill Discovery Component (Conversational Install)

```typescript
function SkillBrowser({ agentEndpoint, apiKey, telegramLink }) {
  const [skills, setSkills] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Fetch installed skills (for display only)
  useEffect(() => {
    async function fetchSkills() {
      const response = await fetch(`${agentEndpoint}/api/skills`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const data = await response.json();
      if (data.ok) {
        setSkills(data.skills);
      }
    }
    fetchSkills();
  }, [agentEndpoint, apiKey]);
  
  // Search for skills (debounced)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${agentEndpoint}/api/skills/search?q=${encodeURIComponent(searchQuery)}`,
          { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        const data = await response.json();
        if (data.ok) {
          setSearchResults(data.results);
        }
      } finally {
        setLoading(false);
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [searchQuery, agentEndpoint, apiKey]);
  
  // Copy install command to clipboard
  const copyInstallCommand = (skillName: string) => {
    const message = `Install the ${skillName} skill`;
    navigator.clipboard.writeText(message);
    alert(`Copied! Now message your agent on Telegram.`);
  };
  
  return (
    <div className="skill-browser">
      <h3>Installed Skills</h3>
      <ul>
        {skills.map(skill => (
          <li key={skill.slug}>
            <span>{skill.slug} v{skill.version}</span>
          </li>
        ))}
      </ul>
      
      <div className="callout">
        💬 To install, update, or remove skills, message your agent on Telegram.
        <a href={telegramLink} target="_blank">Open Telegram Bot</a>
      </div>
      
      <h3>Browse Available Skills</h3>
      <input
        type="text"
        placeholder="Search ClawHub..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      {loading && <p>Searching...</p>}
      {searchResults.length > 0 && (
        <ul>
          {searchResults.map(result => (
            <li key={result.slug}>
              <div>
                <strong>{result.name || result.slug}</strong>
                <p>{result.description}</p>
                <small>by {result.author} • v{result.version}</small>
              </div>
              <button onClick={() => copyInstallCommand(result.name || result.slug)}>
                📋 Copy Install Message
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### 7. WebSocket Chat Component

**For custom web dashboards:**

```typescript
import { useEffect, useState, useRef } from 'react';

interface Message {
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

function AgentWebSocketChat({ 
  agentEndpoint, 
  gatewayToken, 
  userId 
}: {
  agentEndpoint: string;
  gatewayToken: string;
  userId: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to gateway WebSocket
    const wsUrl = agentEndpoint.replace('http', 'ws');
    ws.current = new WebSocket(`${wsUrl}/gateway?token=${gatewayToken}`);
    
    ws.current.onopen = () => {
      console.log('Connected to agent gateway');
      setConnected(true);
    };
    
    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'message' && data.content) {
          setMessages(prev => [...prev, {
            role: 'agent',
            content: data.content,
            timestamp: Date.now()
          }]);
        }
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };
    
    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnected(false);
    };
    
    ws.current.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    };
    
    return () => {
      ws.current?.close();
    };
  }, [agentEndpoint, gatewayToken]);
  
  const sendMessage = () => {
    if (!input.trim() || !ws.current || ws.current.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const message = input.trim();
    
    // Add to UI immediately
    setMessages(prev => [...prev, {
      role: 'user',
      content: message,
      timestamp: Date.now()
    }]);
    
    // Send to agent via WebSocket
    ws.current.send(JSON.stringify({
      type: "message",
      content: message,
      sessionId: userId // Critical for maintaining conversation context
    }));
    
    setInput('');
  };
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };
  
  return (
    <div className="agent-chat">
      <div className="chat-header">
        <h3>Agent Chat</h3>
        <span className={`status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>
      
      <div className="messages-container">
        {messages.length === 0 && (
          <div className="empty-state">
            Start chatting with your agent...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-header">
              <strong>{msg.role === 'user' ? 'You' : 'Agent'}</strong>
              <span className="timestamp">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}
      </div>
      
      <div className="input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
          disabled={!connected}
          rows={3}
        />
        <button onClick={sendMessage} disabled={!connected || !input.trim()}>
          Send
        </button>
      </div>
      
      {!connected && (
        <div className="connection-help">
          Make sure the agent is configured and the gateway token is correct.
        </div>
      )}
    </div>
  );
}

// Example: Get gateway token from status endpoint (if exposed)
async function getGatewayToken(agentEndpoint: string, apiKey: string): Promise<string> {
  const response = await fetch(`${agentEndpoint}/api/status`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  const data = await response.json();
  
  // Gateway token might be in status response
  // Otherwise, you'll need to get it from the server configuration
  return data.gatewayToken || 'YOUR_GATEWAY_TOKEN';
}
```

**For end-users (not dashboards):**

For mobile users and end-users, Telegram/Discord is still recommended:
1. Configure Telegram/Discord bot via `POST /api/configure`
2. Users interact through those channels
3. Monitor and manage via `/api/pairing` and status endpoints

```typescript
// Example: Check if channels are configured
async function checkChannels(agentEndpoint: string, apiKey: string) {
  const response = await fetch(`${agentEndpoint}/api/status`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  const data = await response.json();
  
  return {
    hasTelegram: data.configured && data.telegramConfigured,
    hasDiscord: data.configured && data.discordConfigured
  };
}
```

## Error Handling

### Common HTTP Status Codes

- `200 OK` - Success
- `400 Bad Request` - Invalid request body or parameters
- `401 Unauthorized` - Missing or invalid API key
- `500 Internal Server Error` - Gateway or configuration error

### Example Error Handler

```typescript
async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
  
  return await response.json();
}
```

## Security Best Practices

1. **Store API Keys Securely**
   - Never expose `WRAPPER_API_KEY` in frontend code
   - Store in your backend database, encrypted at rest
   - Only send to browser over HTTPS

2. **Proxy API Calls**
   - Don't make direct calls from browser to agent endpoints
   - Route through your backend API
   - Your backend holds the API keys

3. **Validate Input**
   - Sanitize user inputs before sending to API
   - Validate provider/model selections against allowed lists

4. **Rate Limiting**
   - Implement rate limiting in your frontend
   - Use debouncing for status polling
   - Don't poll faster than 5s intervals

## Complete Example: Agent Management UI

```typescript
// App.tsx
import React, { useState, useEffect } from 'react';

interface Agent {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;  // Fetched from your backend
}

function AgentManager({ agent }: { agent: Agent }) {
  const [status, setStatus] = useState(null);
  const [pairings, setPairings] = useState([]);
  
  useEffect(() => {
    // Poll status every 5 seconds
    const fetchStatus = async () => {
      const response = await fetch(`${agent.endpoint}/api/status`, {
        headers: { 'Authorization': `Bearer ${agent.apiKey}` }
      });
      setStatus(await response.json());
    };
    
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [agent]);
  
  useEffect(() => {
    // Poll pairings every 10 seconds
    const fetchPairings = async () => {
      const response = await fetch(`${agent.endpoint}/api/pairing`, {
        headers: { 'Authorization': `Bearer ${agent.apiKey}` }
      });
      const data = await response.json();
      setPairings(data.pending || []);
    };
    
    fetchPairings();
    const interval = setInterval(fetchPairings, 10000);
    return () => clearInterval(interval);
  }, [agent]);
  
  const handleApprove = async (channel, code) => {
    await fetch(`${agent.endpoint}/api/pairing/approve`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${agent.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ channel, code })
    });
    
    // Refresh pairings
    const response = await fetch(`${agent.endpoint}/api/pairing`, {
      headers: { 'Authorization': `Bearer ${agent.apiKey}` }
    });
    const data = await response.json();
    setPairings(data.pending || []);
  };
  
  return (
    <div className="agent-card">
      <h2>{agent.name}</h2>
      
      {/* Status Display */}
      {status && (
        <div className="status">
          <span className={`badge ${status.gateway.running ? 'success' : 'danger'}`}>
            {status.gateway.running ? 'Running' : 'Stopped'}
          </span>
          <p>Version: {status.openclawVersion}</p>
          <p>Configured: {status.configured ? 'Yes' : 'No'}</p>
        </div>
      )}
      
      {/* Pending Pairings */}
      {pairings.length > 0 && (
        <div className="pairings">
          <h3>Pending Approvals ({pairings.length})</h3>
          <ul>
            {pairings.map(p => (
              <li key={p.code}>
                <span>{p.channel}: {p.code}</span>
                <button onClick={() => handleApprove(p.channel, p.code)}>
                  Approve
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default AgentManager;
```

---

## Complete Example: Agent with Skills Management

```typescript
// App.tsx
import React, { useState, useEffect } from 'react';

interface Agent {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
}

function FullFeaturedAgentDashboard({ agent }: { agent: Agent }) {
  const [status, setStatus] = useState(null);
  const [skills, setSkills] = useState([]);
  
  // Poll agent status
  useEffect(() => {
    const fetchStatus = async () => {
      const response = await fetch(`${agent.endpoint}/api/status`, {
        headers: { 'Authorization': `Bearer ${agent.apiKey}` }
      });
      setStatus(await response.json());
    };
    
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [agent]);
  
  // Fetch skills on mount
  useEffect(() => {
    const fetchSkills = async () => {
      const response = await fetch(`${agent.endpoint}/api/skills`, {
        headers: { 'Authorization': `Bearer ${agent.apiKey}` }
      });
      const data = await response.json();
      if (data.ok) setSkills(data.skills);
    };
    fetchSkills();
  }, [agent]);
  
  // Install skill
  const installSkill = async (slug: string) => {
    const response = await fetch(`${agent.endpoint}/api/skills/install`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${agent.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ slug })
    });
    const data = await response.json();
    if (data.ok) {
      alert(`✓ Installed ${slug}. Restart agent to activate.`);
      // Refresh skills
      const listResponse = await fetch(`${agent.endpoint}/api/skills`, {
        headers: { 'Authorization': `Bearer ${agent.apiKey}` }
      });
      const listData = await listResponse.json();
      if (listData.ok) setSkills(listData.skills);
    } else {
      alert(`Error: ${data.error}`);
    }
  };
  
  
  return (
    <div className="agent-dashboard">
      {/* Status Card */}
      {status && (
        <div className="status-card">
          <h2>{agent.name}</h2>
          <span className={`badge ${status.gateway.running ? 'success' : 'danger'}`}>
            {status.gateway.running ? 'Online' : 'Offline'}
          </span>
          <p>Version: {status.openclawVersion}</p>
        </div>
      )}
      
      {/* Skills Panel */}
      <div className="skills-panel">
        <h3>Installed Skills ({skills.length})</h3>
        <ul>
          {skills.map(skill => (
            <li key={skill.slug}>
              {skill.slug} <small>v{skill.version}</small>
            </li>
          ))}
        </ul>
        <button onClick={() => {
          const slug = prompt('Enter skill slug to install:');
          if (slug) installSkill(slug);
        }}>
          + Install Skill
        </button>
      </div>
      
      {/* Channel Integration Info */}
      <div className="channels-panel">
        <h3>Interact with Agent</h3>
        <p>Use Telegram or Discord to chat with your agent:</p>
        <ol>
          <li>Configure a bot using POST /api/configure</li>
          <li>Users chat through Telegram/Discord</li>
          <li>Monitor via /api/pairing for new users</li>
        </ol>
      </div>
    </div>
  );
}

export default FullFeaturedAgentDashboard;
```

---

## Migration from Setup Wizard

If you have users currently using the `/setup` wizard, both approaches work side-by-side:

- **Wizard UI**: Users can still visit `/setup` to configure via web browser
- **API**: Your custom frontend can use these APIs for programmatic control
- **Coexistence**: Both use the same underlying gateway configuration

To fully disable the wizard UI in production, set environment variable:
```bash
DISABLE_SETUP_UI=true
```

This will return 404 for `/setup` routes while keeping API routes active.
