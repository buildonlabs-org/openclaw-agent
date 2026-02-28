# Quick Test Commands - Copy & Paste

Token: `f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659`

## Fixed Commands (Copy-paste ready)

### 1. Channels Status
```bash
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" http://localhost:8080/api/channels
```

### 2. List Models  
```bash
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" http://localhost:8080/api/models
```

### 3. Get Config Path (Required)
```bash
# Gateway port
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" "http://localhost:8080/api/config?path=gateway.port"

# AI Provider
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" "http://localhost:8080/api/config?path=aiProvider"
```

### 4. List Sessions (Fixed)
```bash
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" http://localhost:8080/api/sessions
```

### 5. Agent Status (Existing)
```bash
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" http://localhost:8080/api/status
```

---

## All at once with formatted output

```bash
# 1. Channels
echo "=== CHANNELS ==="
curl -s -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" http://localhost:8080/api/channels | jq

# 2. Models
echo -e "\n=== MODELS ==="
curl -s -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" http://localhost:8080/api/models | jq

# 3. Config (gateway.port)
echo -e "\n=== CONFIG (gateway.port) ==="
curl -s -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" "http://localhost:8080/api/config?path=gateway.port" | jq

# 4. Config (aiProvider)
echo -e "\n=== CONFIG (aiProvider) ==="
curl -s -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" "http://localhost:8080/api/config?path=aiProvider" | jq

# 5. Sessions
echo -e "\n=== SESSIONS ==="
curl -s -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" http://localhost:8080/api/sessions | jq

# 6. Status
echo -e "\n=== STATUS ==="
curl -s -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" http://localhost:8080/api/status | jq '.gateway'
```

---

## What Changed

**Fixed Issues:**
1. ✅ `/api/sessions` - Changed from `openclaw sessions list` to `openclaw sessions` (no "list" argument)
2. ✅ `/api/config` - Now REQUIRES `?path=` query parameter and uses `openclaw config get <path>`

**Correct usage:**
- Get config value: `GET /api/config?path=gateway.port` → `openclaw config get gateway.port`
- List sessions: `GET /api/sessions` → `openclaw sessions` (no arguments)

**Error if you forget path:**
```json
{
  "ok": false,
  "error": "Missing required query parameter: path",
  "hint": "Use /api/config?path=gateway.port or similar"
}
```
