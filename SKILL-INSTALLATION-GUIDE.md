# Skill Installation Guide

## ✅ Working Solution

Skills can be installed via the **API endpoint**, which works perfectly without any pairing requirements.

### Install Skills via API

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug": "skill-name"}' \
  https://your-agent.railway.app/api/skills/install | jq '.'
```

**Example:**
```bash
curl -X POST \
  -H "Authorization: Bearer 6c6564c444a681d7083ec4014b0bbc6bcbecb62097643f8b69ce1dc5c5e2706f" \
  -H "Content-Type: application/json" \
  -d '{"slug": "gog"}' \
  https://hyperliquid-trader-production.up.railway.app/api/skills/install | jq '.'
```

**Response:**
```json
{
  "ok": true,
  "slug": "gog",
  "version": "latest",
  "output": "✔ OK. Installed gog -> /data/workspace/skills/gog\n",
  "exitCode": 0
}
```

### List Installed Skills

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/skills | jq '.'
```

### Update a Skill

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug": "skill-name"}' \
  https://your-agent.railway.app/api/skills/update | jq '.'
```

### Delete a Skill

```bash
curl -X DELETE \
  -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/skills/skill-name | jq '.'
```

---

## ⚠️ Chat-Based Installation

Installing skills from **chat** (Telegram/Discord) currently **does not work** due to OpenClaw's cryptographic device pairing requirements.

### Why Chat Installation Doesn't Work

OpenClaw requires **Ed25519 cryptographic signatures** for device pairing when performing privileged operations (like skill installation) through the Gateway. This requires:

1. Ed25519 keypair generation
2. SHA256 hash of public key as device ID
3. Cryptographic signature of challenges
4. Complex signing protocol

The error you'll see:
```
invalid connect params: 
  must have required property 'publicKey'
  must have required property 'signature'
  must have required property 'signedAt'
  must have required property 'nonce'
```

### Workaround

**Instead of chat commands like:**
```
User: "Install the hyperliquid skill"
```

**Use the API endpoint or build a frontend UI** that calls the skill installation API.

---

## 🎯 Recommended Approach

### For Users

**Option 1: Pre-install Skills at Deployment**

Set the `OPENCLAW_DEFAULT_SKILLS` environment variable:
```bash
OPENCLAW_DEFAULT_SKILLS="skill1,skill2,skill3"
```

Skills will be auto-installed on first container startup.

**Option 2: Build a Frontend UI**

Create a web interface that:
1. Lists available skills (via `GET /api/skills/search`)
2. Shows installed skills (via `GET /api/skills`)
3. Provides "Install" buttons that call `POST /api/skills/install`

**Option 3: Use the API Directly**

For programmatic/automation use cases, call the API endpoints directly.

---

## 🔮 Future Enhancement

To enable chat-based skill installation, we would need to:

1. **Implement Ed25519 Crypto:**
   - Generate Ed25519 keypair on startup
   - Store private key securely
   - Implement signing protocol
   - Calculate SHA256 device ID from public key

2. **Handle Device Approval Flow:**
   - Detect pairing requests
   - Auto-approve or provide approval UI
   - Persist device identity

3. **Code Changes Required:**
   - Add `@noble/ed25519` or similar crypto library
   - Implement signing in `gatewayClient.js`
   - Add device approval API endpoints
   - Update documentation

**Complexity:** High (several hours of development + testing)

**Benefit:** Chat-based skill installation (convenient but not critical since API works)

---

## 📊 Comparison

| Method | Complexity | Works? | Use Case |
|--------|-----------|--------|----------|
| **API Endpoint** | ✅ Simple | ✅ Yes | Automation, frontends, pre-install |
| **Chat Commands** | ❌ Complex | ❌ No | Natural language interaction |
| **Frontend UI** | ✅ Simple | ✅ Yes | User-friendly installation |
| **Pre-install ENV** | ✅ Simple | ✅ Yes | First-time deployment |

---

## 🚀 Quick Start

**1. Check installed skills:**
```bash
curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
  https://hyperliquid-trader-production.up.railway.app/api/skills | jq '.'
```

**2. Search for skills:**
```bash
curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
  "https://hyperliquid-trader-production.up.railway.app/api/skills/search?q=trading" | jq '.'
```

**3. Install a skill:**
```bash
curl -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug": "skill-name"}' \
  https://hyperliquid-trader-production.up.railway.app/api/skills/install | jq '.'
```

**4. Verify installation:**
```bash
curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
  https://hyperliquid-trader-production.up.railway.app/api/skills | jq '.skills[] | .slug'
```

---

## 📖 API Documentation

See [API.md](API.md) for complete API reference:
- `GET /api/skills` - List installed skills
- `GET /api/skills/search` - Search ClawHub
- `POST /api/skills/install` - Install a skill
- `POST /api/skills/update` - Update a skill
- `DELETE /api/skills/:slug` - Delete a skill

---

## 🎉 Summary

✅ **Skill installation works great via API**  
✅ **No device pairing hassles**  
✅ **Clean, simple implementation**  
❌ **Chat-based installation not available** (complex crypto required)

**Recommendation:** Use API endpoints or build a simple frontend UI. Chat works perfectly for everything else (general questions, data queries, etc.) - just not privileged operations like skill installation.
