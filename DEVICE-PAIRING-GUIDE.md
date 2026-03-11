# Device Pairing Guide for Skill Installation

## ⚠️ Why Device Pairing is Required

OpenClaw treats certain operations as **privileged** and requires **device/node pairing approval** to perform them. This is a security feature.

**Privileged operations include:**
- Installing skills from ClawHub (`clawhub install`)
- Spawning new sessions
- Executing system commands
- Modifying control-plane state

### The Key Distinction

There are **two types of pairing** in OpenClaw:

1. **Channel Pairing** (Telegram/Discord DMs) - For users to chat with your bot
2. **Device/Node Pairing** - For the backend node to perform privileged operations

**Your situation:** Telegram channel pairing works fine, but **skill installation fails** because the backend node (Railway container) needs device pairing approval.

---

## 🔍 Symptoms

When trying to install a skill from chat, you see errors like:

```
disconnected (1008): pairing required
```

Or in the API response:
```json
{
  "ok": false,
  "error": "Device pairing required",
  "deviceId": "a1b2c3d4e5f6..."
}
```

---

## ✅ Solution: Approve Device Pairing

### Quick Fix (3 Steps)

#### Step 1: Check Device Status

**Via API:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/devices/status
```

**Response:**
```json
{
  "ok": true,
  "deviceId": "a1b2c3d4e5f6789...",
  "pairingRequired": true,
  "help": {
    "message": "Device pairing is required..."
  }
}
```

#### Step 2: List Pending Device Requests

**Via API:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/devices
```

**Via CLI (on gateway host):**
```bash
openclaw devices list
```

**Output:**
```
Pending device pairing requests:
  requestId: a1b2c3d4e5f6
  device: openclaw-agent-a1b2c3d4
  status: pending
```

#### Step 3: Approve the Device

**Via API:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"requestId": "a1b2c3d4e5f6"}' \
  https://your-agent.railway.app/api/devices/approve
```

**Via CLI (on gateway host):**
```bash
openclaw devices approve a1b2c3d4e5f6
```

**Success!** Your device is now approved and skill installation will work.

---

## 🔄 Persistence: Avoid Repeated Approvals

Your container now uses a **persistent device ID** stored in:
```
/data/.openclaw/device.id
```

Because Railway mounts `/data` as a persistent volume (configured in `railway.toml`), the device ID survives container restarts/redeployments.

**This means:** Once approved, you won't need to approve again unless:
- You delete the persistent volume
- You manually delete `/data/.openclaw/device.id`
- You create a new Railway deployment from scratch

---

## 📖 How It Works

### Before This Fix

The Gateway client was configured to **skip device pairing**:
```javascript
// gatewayClient.js (old)
params: {
  auth: { token: this.token },
  // Omit device field to skip device pairing requirement  ❌
}
```

This worked for basic operations (chat) but **failed for privileged operations** (skill install).

### After This Fix

The Gateway client now includes a **persistent device ID**:
```javascript
// gatewayClient.js (new)
params: {
  auth: { token: this.token },
  device: {
    id: this.deviceId,              // ✅ Persistent device ID
    name: "openclaw-agent-...",
    type: "node",
    platform: "linux"
  }
}
```

**Device ID generation:**
1. On first run: Generate random 32-byte device ID
2. Store in `/data/.openclaw/device.id`
3. On subsequent runs: Reuse the same device ID

**Pairing flow:**
1. Backend connects to Gateway with device ID
2. Gateway rejects with "pairing required"
3. Admin approves via `openclaw devices approve <requestId>`
4. Gateway accepts future connections from this device ID
5. Privileged operations (skill install) now work!

---

## 🛠️ Troubleshooting

### Issue: "No pending device request found"

**Cause:** The container hasn't tried to connect yet.

**Fix:**
1. Restart the Railway container (to trigger a new connection attempt)
2. Check logs for: `[gateway] Device pairing required for device ID: ...`
3. Run `openclaw devices list` immediately
4. Approve the request

### Issue: "Device keeps getting unpaired after redeployment"

**Cause:** The persistent volume isn't properly mounted.

**Fix:**
1. Check `railway.toml` has:
   ```toml
   [[volumes]]
   name = "data"
   mountPath = "/data"
   ```
2. Verify in Railway dashboard that volume is attached
3. Check logs: `[gateway] Using existing device ID: ...` (should say "existing", not "new")

### Issue: "Still getting pairing errors after approval"

**Cause:** Multiple issues possible.

**Fix (in order):**
1. **Check approval succeeded:**
   ```bash
   openclaw devices list
   # Should NOT show your device as "pending"
   ```

2. **Restart the Gateway:**
   ```bash
   # In Railway dashboard, restart the deployment
   # OR trigger via API: POST /api/admin/restart (if implemented)
   ```

3. **Check exec approvals (advanced):**
   If `clawhub install` is treated as an exec command, you may also need:
   ```bash
   openclaw approvals list
   openclaw approvals approve <approvalId>
   ```

### Issue: "Error 403 when installing skill"

**This is the expected behavior!** The API now properly detects pairing issues and returns:

```json
{
  "ok": false,
  "error": "Device pairing required",
  "deviceId": "...",
  "instructions": {
    "cli": ["openclaw devices list", "openclaw devices approve <requestId>"],
    "api": ["GET /api/devices", "POST /api/devices/approve"]
  }
}
```

Follow the instructions in the response to approve the device.

---

## 📚 API Reference

### GET /api/devices/status
Check device pairing status for this backend instance.

**Response:**
```json
{
  "ok": true,
  "deviceId": "a1b2c3d4e5f6789...",
  "deviceIdPersisted": true,
  "pairingRequired": false,
  "stateDir": "/data/.openclaw",
  "help": {
    "message": "Device pairing status OK",
    "commands": ["openclaw devices list", "openclaw devices approve <requestId>"]
  }
}
```

### GET /api/devices
List pending device pairing requests.

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

### POST /api/devices/approve
Approve a device pairing request.

**Request:**
```json
{
  "requestId": "a1b2c3d4e5f6"
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

---

## 🚀 Testing the Fix

### Test 1: Check Device Status
```bash
curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
  https://your-agent.railway.app/api/devices/status
```

### Test 2: Try Installing a Skill (Before Approval)
```bash
curl -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug": "test-skill"}' \
  https://your-agent.railway.app/api/skills/install
```

**Expected:** 403 error with device pairing instructions.

### Test 3: Approve Device
```bash
# List devices
curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
  https://your-agent.railway.app/api/devices

# Approve (replace with actual requestId)
curl -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"requestId": "a1b2c3d4e5f6"}' \
  https://your-agent.railway.app/api/devices/approve
```

### Test 4: Try Installing Again (After Approval)
```bash
curl -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug": "test-skill"}' \
  https://your-agent.railway.app/api/skills/install
```

**Expected:** Success (or rate limit error, which is different from pairing error).

---

## 🔐 Security Considerations

### Why This Security Feature Exists

OpenClaw's device pairing prevents:
- Unauthorized nodes from executing privileged operations
- Rogue containers from installing malicious skills
- Man-in-the-middle attacks on the Gateway connection

### Best Practices

1. **Approve devices promptly** - Don't leave pending requests for days
2. **Monitor device list** - Regularly check `openclaw devices list` for unexpected devices
3. **Revoke compromised devices** - If a device ID is leaked, revoke it:
   ```bash
   openclaw devices revoke <deviceId>
   ```
4. **Rotate Gateway tokens** - If tokens are compromised, regenerate and update env vars

### Additional Security Layers

If you're paranoid (good!), consider:
- **Exec approvals** - Require approval for each `clawhub install` command
- **Skill allowlists** - Only allow installing specific approved skills
- **Network isolation** - Run Gateway and backend on isolated network

---

## 📞 Still Having Issues?

If this guide doesn't solve your problem:

1. **Check logs:**
   - Railway logs for `[gateway]` messages
   - Look for "pairing required" or "1008" errors

2. **Verify environment:**
   - `OPENCLAW_STATE_DIR=/data/.openclaw` is set
   - `/data` volume is mounted (check Railway dashboard)
   - Gateway is running (`GET /` should return success)

3. **Check OpenClaw version:**
   ```bash
   openclaw --version
   ```
   Make sure you're on v2026.2.23 or newer.

4. **Gather diagnostics:**
   ```bash
   # API status
   curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
     https://your-agent.railway.app/api/devices/status
   
   # Device list
   curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
     https://your-agent.railway.app/api/devices
   
   # Skill installation logs
   # (check Railway logs after attempting install)
   ```

5. **Open an issue** with:
   - Full error message
   - Device pairing status
   - OpenClaw version
   - Railway logs (sanitize tokens!)

---

## 📝 Summary

**Problem:** Skill installation fails with "pairing required" because privileged operations need device approval.

**Solution:** 
1. Enable device pairing in Gateway client ✅
2. Generate and persist device ID ✅
3. Approve device via `openclaw devices approve` ✅
4. Profit! Skills install successfully ✅

**Key files changed:**
- `src/gatewayClient.js` - Added device pairing support
- `src/server.js` - Added device status endpoint and pairing error detection
- `railway.toml` - Already had persistent volume configured

**One-time setup required:** Approve the device after first deployment.

**Ongoing:** Device ID persists across redeployments, no repeated approvals needed.

🎉 **You're all set!**
