# Correct API Endpoint Usage

## Your Issue
You were trying to access:
```
POST https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/agents/598e75e7-f87e-4825-817a-5bc01b64fa5c/proxy/api/chat
```

This resulted in **504 Gateway Timeout** because:
1. ❌ Wrong port: **3000** (should be **8080**)
2. ❌ Wrong route: `/api/agents/.../proxy/api/chat` doesn't exist
3. ❌ Correct route is: `/api/chat`

---

## Correct Usage

### Base URL
```
https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev
```
*(Replace port if you set $PORT differently)*

### Get API Key
Your API key is in one of these environment variables:
- `WRAPPER_API_KEY` (preferred)
- `OPENCLAW_GATEWAY_TOKEN` (fallback)

Check your Railway/Codespaces environment variables or the server logs.

---

## Working Examples

### 1. Check Status (Verify Server is Running)
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev/api/status
```

**Success Response:**
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

### 2. Send Chat Message (What You Actually Want)
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 2+2?"}' \
  https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev/api/chat
```

**Success Response:**
```json
{
  "ok": true,
  "agentId": "main",
  "sessionKey": "api-session-1709493600000",
  "response": "2+2 equals 4.",
  "timestamp": "2026-03-03T20:00:00.000Z"
}
```

### 3. With Session Persistence
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Remember this number: 42",
    "sessionKey": "user-alice"
  }' \
  https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev/api/chat
```

Then in the next request:
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What number did I ask you to remember?",
    "sessionKey": "user-alice"
  }' \
  https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev/api/chat
```

The agent will remember "42" because you used the same `sessionKey`.

---

## Request Format

### Required Headers
```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

### Request Body
```json
{
  "message": "Your message text here",
  "sessionKey": "optional-user-id-for-session-persistence",
  "agentId": "optional-agent-id-default-is-main"
}
```

### Required Fields
- `message` (string) - The message to send to the agent

### Optional Fields
- `sessionKey` (string) - Session identifier for conversation persistence. Use the same key for related messages.
- `agentId` (string) - Agent identifier (default: "main")

---

## Error Responses

### 400 Bad Request
```json
{
  "ok": false,
  "error": "Missing required field: message"
}
```
**Fix:** Include `message` in request body

### 401 Unauthorized
```json
{
  "ok": false,
  "error": "Unauthorized"
}
```
**Fix:** Include `Authorization: Bearer YOUR_API_KEY` header

### 503 Service Unavailable
```json
{
  "ok": false,
  "error": "Gateway not ready"
}
```
**Fix:** Wait for gateway to start, or check configuration

### 504 Gateway Timeout
```json
{
  "ok": false,
  "error": "Gateway timeout or connection closed"
}
```
**Fix:** Check gateway logs, run `/api/doctor`, or restart gateway

---

## JavaScript/TypeScript Example

```javascript
const API_KEY = process.env.WRAPPER_API_KEY;
const BASE_URL = "https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev";

async function chatWithAgent(message, sessionKey = null) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      sessionKey
    })
  });
  
  const data = await response.json();
  
  if (data.ok) {
    console.log('Agent:', data.response);
    return data.response;
  } else {
    console.error('Error:', data.error);
    throw new Error(data.error);
  }
}

// Usage
chatWithAgent("Hello, how are you?", "user-123")
  .then(response => console.log('Response:', response))
  .catch(err => console.error('Failed:', err));
```

---

## Python Example

```python
import requests
import os

API_KEY = os.environ['WRAPPER_API_KEY']
BASE_URL = "https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev"

def chat_with_agent(message, session_key=None):
    response = requests.post(
        f"{BASE_URL}/api/chat",
        headers={
            'Authorization': f'Bearer {API_KEY}',
            'Content-Type': 'application/json'
        },
        json={
            'message': message,
            'sessionKey': session_key
        }
    )
    
    data = response.json()
    
    if data['ok']:
        print(f"Agent: {data['response']}")
        return data['response']
    else:
        raise Exception(data['error'])

# Usage
response = chat_with_agent("Hello!", "user-123")
print(f"Got response: {response}")
```

---

## Testing

### Quick Test Script
```bash
chmod +x quick-test.sh
./quick-test.sh
```

### Or Manual Test
Replace `YOUR_API_KEY` with your actual API key:
```bash
API_KEY="your-key-here"
BASE_URL="https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev"

# Test it works
curl -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "say OK if you can read this"}' \
  "$BASE_URL/api/chat"
```

---

## Port Forwarding (Codespaces)

If you're in GitHub Codespaces and can't access port 8080:

1. Open the **Ports** panel (bottom of VS Code)
2. Find port **8080**
3. Right-click → **Port Visibility** → **Public**
4. Use the forwarded URL shown (format: `https://xxx-8080.app.github.dev`)

---

## Summary

| What You Used (Wrong) | What to Use (Correct) |
|-----------------------|------------------------|
| Port 3000 | Port 8080 |
| `/api/agents/.../proxy/api/chat` | `/api/chat` |
| Complex route | Simple route |

**Working endpoint:**
```
POST https://laughing-pancake-x5jqw7r5qww365x-8080.app.github.dev/api/chat
```

**With headers:**
```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

**With body:**
```json
{"message": "your message"}
```

That's it! 🎉
