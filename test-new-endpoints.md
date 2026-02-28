# Test New OpenClaw API Endpoints

Bearer Token: `f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659`

## 1. Get Channels Status

```bash
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  http://localhost:8080/api/channels
```

**Expected Response:**
```json
{
  "ok": true,
  "output": "telegram: connected (@mybot)\n...",
  "channels": [
    {
      "type": "telegram",
      "status": "connected",
      "info": "@mybot"
    }
  ],
  "exitCode": 0
}
```

---

## 2. List Available Models

```bash
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  http://localhost:8080/api/models
```

**Expected Response:**
```json
{
  "ok": true,
  "output": "openai/gpt-4 (8k context)\n...",
  "models": [
    {
      "provider": "openai",
      "name": "gpt-4",
      "details": "8k context",
      "raw": "openai/gpt-4 (8k context)"
    }
  ],
  "exitCode": 0
}
```

---

## 3. Get Configuration

```bash
# Get gateway port
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  "http://localhost:8080/api/config?path=gateway.port"

# Get AI provider
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  "http://localhost:8080/api/config?path=aiProvider"
```

**Expected Response:**
```json
{
  "ok": true,
  "output": "18789",
  "config": "18789",
  "path": "gateway.port",
  "exitCode": 0
}
```

---

## 4. List Active Sessions

```bash
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  http://localhost:8080/api/sessions
```

**Expected Response:**
```json
{
  "ok": true,
  "output": "session-abc123 telegram @user1 active\n...",
  "sessions": [
    {
      "id": "session-abc123",
      "raw": "session-abc123 telegram @user1 active"
    }
  ],
  "count": 1,
  "exitCode": 0
}
```

---

## 5. Combined Test (all endpoints)

```bash
# Channels
curl -s -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  http://localhost:8080/api/channels | jq '.channels'

# Models
curl -s -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  http://localhost:8080/api/models | jq '.models'

# Config
curl -s -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  http://localhost:8080/api/config | jq '.config'

# Sessions
curl -s -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  http://localhost:8080/api/sessions | jq '.sessions'
```

---

## Run All Tests

```bash
# Make script executable
chmod +x test-new-endpoints.sh

# Run tests
./test-new-endpoints.sh
```

---

## Python Example

```python
import requests

API_KEY = "f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659"
BASE_URL = "http://localhost:8080"
headers = {"Authorization": f"Bearer {API_KEY}"}

# Get channels status
channels = requests.get(f"{BASE_URL}/api/channels", headers=headers).json()
print("Channels:", channels['channels'])

# Get models
models = requests.get(f"{BASE_URL}/api/models", headers=headers).json()
print("Models:", models['models'])

# Get config
config = requests.get(f"{BASE_URL}/api/config", headers=headers).json()
print("Config:", config['config'])

# Get sessions
sessions = requests.get(f"{BASE_URL}/api/sessions", headers=headers).json()
print("Sessions:", sessions['sessions'])
```

---

## JavaScript/Node Example

```javascript
const API_KEY = "f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659";
const BASE_URL = "http://localhost:8080";

async function testEndpoints() {
  const headers = { 'Authorization': `Bearer ${API_KEY}` };
  
  // Get channels status
  const channels = await fetch(`${BASE_URL}/api/channels`, { headers })
    .then(r => r.json());
  console.log('Channels:', channels.channels);
  
  // Get models
  const models = await fetch(`${BASE_URL}/api/models`, { headers })
    .then(r => r.json());
  console.log('Models:', models.models);
  
  // Get config
  const config = await fetch(`${BASE_URL}/api/config`, { headers })
    .then(r => r.json());
  console.log('Config:', config.config);
  
  // Get sessions
  const sessions = await fetch(`${BASE_URL}/api/sessions`, { headers })
    .then(r => r.json());
  console.log('Sessions:', sessions.sessions);
}

testEndpoints();
```
