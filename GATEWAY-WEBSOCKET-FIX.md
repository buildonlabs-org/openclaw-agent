# Gateway WebSocket Connection Fix

## The Problem

Users were experiencing errors when trying to chat via `/api/chat`, even though configuration and status checks showed the gateway was running. The error manifested as:
- "Gateway not ready" errors
- "Pairing required" confusion (unrelated to the actual issue)
- Chat requests timing out

## Root Cause

There was a **race condition** between:
1. **Gateway subprocess starting** (checked by `isGatewayReady()`)
2. **WebSocket server being ready** to accept connections

### The Flow Before Fix

```
1. User sends chat message to /api/chat
2. isGatewayReady() checks if gateway subprocess exists ✓
3. getGatewayClient() creates/returns client instance ✓
4. client.sendChat() calls connect() internally
5. connect() tries to establish WebSocket connection
6. ❌ FAILS: Gateway subprocess running but WebSocket not ready yet
7. User sees "Gateway not ready" or timeout error
```

### Why This Happened

The `isGatewayReady()` function only checked:
```javascript
function isGatewayReady() {
  return gatewayProc !== null && !isGatewayStarting();
}
```

This checked if the **subprocess exists**, but didn't verify:
- WebSocket server is listening
- WebSocket connections are accepted
- Authentication handshake works

There's a 5-15 second window after subprocess start where:
- ✅ Gateway HTTP endpoint responds
- ✅ Subprocess is running
- ❌ WebSocket server is still initializing
- ❌ Chat requests fail

## The Fix

### 1. Made `getGatewayClient()` Async and Wait for Connection

**Before:**
```javascript
function getGatewayClient() {
  if (!gatewayClient) {
    gatewayClient = new OpenClawGatewayClient({...});
  }
  return gatewayClient; // Returns immediately, not connected
}
```

**After:**
```javascript
async function getGatewayClient() {
  // Check if already connected
  if (gatewayClient && gatewayClient.ready) {
    return gatewayClient;
  }
  
  // Create new client if needed
  if (!gatewayClient) {
    gatewayClient = new OpenClawGatewayClient({...});
  }
  
  // WAIT for WebSocket connection before returning
  try {
    await gatewayClient.connect();
  } catch (err) {
    gatewayClient = null; // Reset on failure
    throw err;
  }
  
  return gatewayClient;
}
```

Now the client is **guaranteed to be connected** before use.

### 2. Improved Error Messages

**Before:**
```json
{
  "ok": false,
  "error": "Gateway timeout or connection closed"
}
```

**After:**
```json
{
  "ok": false,
  "error": "Gateway WebSocket connection failed",
  "details": "Gateway WebSocket connection timeout after 10s - gateway may still be starting",
  "suggestion": "Gateway may still be initializing. Wait 10-15 seconds and try again."
}
```

Users now understand:
- It's a WebSocket issue specifically
- Gateway is still starting up
- They should wait and retry

### 3. Enhanced Status Endpoint

Added `websocketReady` and `fullyReady` to `/api/status`:

```json
{
  "ok": true,
  "configured": true,
  "gateway": {
    "running": true,           // Subprocess exists
    "reachable": true,          // HTTP endpoint responds
    "websocketReady": true,     // WebSocket client connected
    "fullyReady": true          // All checks pass
  }
}
```

Frontend can now check `fullyReady` before enabling chat.

### 4. Better WebSocket Client Logging

Added detailed connection logging:

```javascript
async connect() {
  console.log('[gateway-client] connecting to ws://...');
  
  // ... connection logic ...
  
  // Better timeout error
  if (Date.now() - start > 10_000) {
    throw new Error(`Gateway WebSocket connection timeout after ${elapsed}s - gateway may still be starting`);
  }
  
  console.log('[gateway-client] connected and ready');
}
```

Server logs now clearly show:
- When WebSocket connection attempts happen
- If they succeed or fail
- Why they failed (timeout, closed, etc.)

## Testing the Fix

### 1. Check Full Readiness

```bash
curl -H "Authorization: Bearer $API_KEY" \
  https://your-domain.app/api/status | jq '.gateway'
```

**Look for:**
```json
{
  "running": true,
  "reachable": true,
  "websocketReady": true,
  "fullyReady": true
}
```

### 2. Send Chat Message

```bash
curl -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}' \
  https://your-domain.app/api/chat
```

**Expected:**
- First request after server start: May take 5-15 seconds (WebSocket connecting)
- Subsequent requests: Fast (WebSocket already connected)
- If fails: Clear error message about WebSocket initialization

### 3. Check Logs

Server logs will show:
```
[gateway-client] connecting to ws://127.0.0.1:18789/gateway?token=***
[gateway-client] connected and ready
```

Or if it fails:
```
[gateway-client] connecting to ws://127.0.0.1:18789/gateway?token=***
[wrapper] failed to connect gateway client: Gateway WebSocket connection timeout after 10s - gateway may still be starting
```

## For Frontend Integration

### Recommended Flow

```javascript
// 1. Check status before enabling chat
const status = await fetch('/api/status', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
}).then(r => r.json());

if (!status.gateway.fullyReady) {
  // Show "Gateway starting..." message
  // Disable chat input
  // Poll every 2 seconds until fullyReady
  setTimeout(checkStatus, 2000);
  return;
}

// 2. Enable chat once fully ready
enableChatInput();

// 3. Send message
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message: 'Hello!' })
});

// 4. Handle errors gracefully
if (!response.ok) {
  const error = await response.json();
  if (error.details?.includes('still be starting')) {
    // Show "Gateway still initializing, please wait..."
    // Retry after delay
  } else {
    // Show actual error
  }
}
```

### Proxy Pattern (Launcher)

When using the launcher proxy pattern:

```javascript
// Client calls launcher proxy
POST /api/agents/:serviceId/proxy/api/chat

// Launcher forwards to agent
POST https://agent.railway.app/api/chat
```

The launcher should also check agent status before proxying:
```javascript
// In launcher proxy handler
const agentStatus = await fetch(`${agent.service_url}/api/status`, {
  headers: { 'Authorization': `Bearer ${agent.apiKey}` }
});

if (!agentStatus.gateway.fullyReady) {
  return res.status(503).json({
    ok: false,
    error: 'Agent gateway still initializing',
    retryAfter: 5000  // Suggest retry in 5 seconds
  });
}

// Proceed with proxying chat request
```

## Summary

| Before | After |
|--------|-------|
| Only checked subprocess | Checks WebSocket connection |
| Race condition on startup | Waits for full readiness |
| Vague error messages | Clear initialization guidance |
| No visibility into WebSocket state | Status endpoint shows all states |
| First chat after start could fail | First chat waits for connection |

**Key Insight:** Gateway readiness has **three stages**:
1. **Subprocess running** (what we checked before)
2. **HTTP endpoint responding** (we checked this)
3. **WebSocket server ready** (we now check this!) ✨

The fix ensures we wait for **all three stages** before accepting chat requests.
