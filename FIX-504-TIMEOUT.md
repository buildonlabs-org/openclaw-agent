# Fix for 504 Gateway Timeout

## Problem
You're getting a 504 Gateway Timeout when trying to access:
```
https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/agents/598e75e7-f87e-4825-817a-5bc01b64fa5c/proxy/api/chat
```

## Root Causes

### 1. Wrong URL Structure ❌
You're using: `/api/agents/.../proxy/api/chat`  
**Correct:** `/api/chat`

This API wrapper doesn't have an agent routing system - it exposes a direct `/api/chat` endpoint.

### 2. Wrong Port ❌
You're accessing port **3000**  
**Correct:** Port **8080** (default) or whatever `PORT` env variable is set to

### 3. Wrong Host Pattern ⚠️
GitHub Codespaces format: `https://{codespace-name}-{port}.app.github.dev`

If your Codespaces URL is `laughing-pancake-x5jqw7r5qww365x`, you need:
```
https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev
```

## Quick Fix

### Step 1: Find Your Correct URL

```bash
# Check what port the server is running on
echo $PORT
# If empty, default is 8080

# Get your Codespaces URL (if in Codespaces)
echo "https://${CODESPACE_NAME}-${PORT:-8080}.app.github.dev"
```

### Step 2: Test the Status Endpoint

```bash
# Replace with your actual values
API_KEY="your-api-key"  # WRAPPER_API_KEY or OPENCLAW_GATEWAY_TOKEN
BASE_URL="https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev"

curl -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/api/status"
```

**Expected Response:**
```json
{
  "ok": true,
  "configured": true,
  "gateway": {
    "running": true,
    "reachable": true
  }
}
```

### Step 3: Test the Chat Endpoint

```bash
curl -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, are you there?"}' \
  "$BASE_URL/api/chat"
```

**Expected Response:**
```json
{
  "ok": true,
  "agentId": "main",
  "sessionKey": "api-session-1234567890",
  "response": "Hello! Yes, I'm here. How can I help you?",
  "timestamp": "2026-03-03T20:00:00.000Z"
}
```

## About the "Pairing Required" Errors

The errors you see in the logs:
```
code: 'NOT_PAIRED',
message: 'pairing required'
```

These are **normal** and **not related to your 504 error**. They occur when:
- WebSocket connections directly to the gateway are attempted
- Telegram/Discord users try to DM the bot before approval
- The gateway's pairing system is working as intended

The `/api/chat` HTTP endpoint **does not require pairing** - it uses an internal gateway client that bypasses pairing.

## Correct API Usage

### Chat Endpoint
```
POST /api/chat
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "message": "Your message here",
  "agentId": "main",           // optional, default: "main"
  "sessionKey": "user-123"     // optional, for session persistence
}
```

### Available Endpoints
- `GET /api/status` - Agent status
- `GET /api/logs?tail=100` - Recent logs
- `POST /api/chat` - Send message to agent
- `POST /api/doctor` - Run diagnostics
- `GET /api/models` - List available models
- `GET /api/pairing` - List pending pairing requests
- `POST /api/pairing/approve` - Approve a pairing request

See [API.md](API.md) for complete documentation.

## Testing Script

Run the included test script:
```bash
# Set your API key
export WRAPPER_API_KEY="your-api-key-here"

# Run the test
./test-chat-api.sh
```

This will automatically:
1. Detect your Codespaces URL or use localhost
2. Check gateway status
3. Send a test message
4. Show the response

## Troubleshooting

### If you still get 504:

1. **Check the server is running:**
   ```bash
   curl -i https://your-url-8080.app.github.dev/health
   ```

2. **Check logs:**
   ```bash
   curl -H "Authorization: Bearer $API_KEY" \
     "$BASE_URL/api/logs?tail=100"
   ```

3. **Verify configuration:**
   ```bash
   curl -H "Authorization: Bearer $API_KEY" \
     "$BASE_URL/api/status"
   ```

4. **Check if gateway is ready:**
   If `gateway.reachable` is `false`, the gateway isn't responding. Try:
   ```bash
   curl -X POST -H "Authorization: Bearer $API_KEY" \
     "$BASE_URL/api/doctor"
   ```

### If gateway shows "NOT_PAIRED" repeatedly:

This is normal for WebSocket connections. However, if the `/api/chat` endpoint also fails with pairing errors:

1. The internal gateway client isn't connecting properly
2. Check if `OPENCLAW_GATEWAY_TOKEN` is set correctly
3. Restart the server to reinitialize the gateway client

## Port Forwarding in Codespaces

If port 8080 isn't accessible:
1. Open the "Ports" tab in VS Code
2. Find port 8080
3. Make sure visibility is set to "Public"
4. Use the forwarded URL shown there

## Summary

**Wrong URL:**
```
❌ https://...-3000.app.github.dev/api/agents/.../proxy/api/chat
```

**Correct URL:**
```
✅ https://...-8080.app.github.dev/api/chat
```

**Required Headers:**
```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

**Request Body:**
```json
{"message": "your message"}
```
