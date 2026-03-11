# Quick Test Guide: hyperliquid-trader-production.up.railway.app

## 🚀 Quick Start

After deploying the fix, run these commands to test device pairing:

### 1. Check Device Status

```bash
curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
  https://hyperliquid-trader-production.up.railway.app/api/devices/status | jq '.'
```

**Expected Response:**
```json
{
  "ok": true,
  "deviceId": "a1b2c3d4e5f6...",
  "deviceIdPersisted": true,
  "pairingRequired": true,  // ← Will be true on first deployment
  "stateDir": "/data/.openclaw"
}
```

### 2. List Pending Device Requests

```bash
curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
  https://hyperliquid-trader-production.up.railway.app/api/devices | jq '.'
```

**Expected Response:**
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

### 3. Approve Device

```bash
# Replace with actual requestId from step 2
curl -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"requestId": "a1b2c3d4e5f6"}' \
  https://hyperliquid-trader-production.up.railway.app/api/devices/approve | jq '.'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Device a1b2c3d4e5f6 approved",
  "output": "Device approved successfully\n"
}
```

### 4. Test Skill Installation

```bash
curl -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug": "test-skill"}' \
  https://hyperliquid-trader-production.up.railway.app/api/skills/install | jq '.'
```

**Before Approval (HTTP 403):**
```json
{
  "ok": false,
  "error": "Device pairing required",
  "deviceId": "a1b2c3d4e5f6...",
  "instructions": { ... }
}
```

**After Approval (HTTP 200 or 429):**
```json
{
  "ok": true,
  "slug": "test-skill",
  "output": "✓ Installed test-skill@1.0.0"
}
```

---

## 🤖 Automated Test Script

Run the automated test script:

```bash
export WRAPPER_API_KEY="your-api-key-here"
chmod +x test-device-pairing.sh
./test-device-pairing.sh
```

The script will:
- Check device status
- List pending devices
- Offer to approve device automatically
- Test skill installation
- Show summary

---

## 🧪 Test from Chat (Telegram/Discord)

After approving the device, test via chat:

```
You: Install the test-skill skill
Bot: I'll install test-skill for you...
Bot: ✓ Installed test-skill@1.0.0
```

---

## 📊 Verify Device Persistence

After container restart/redeploy:

```bash
# Device ID should be the same as before
curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
  https://hyperliquid-trader-production.up.railway.app/api/devices/status | jq '.deviceId'
```

If the device ID persists ✅ = Working correctly  
If it changes ❌ = Volume not mounted correctly

---

## 🔍 Troubleshooting

### Issue: "No pending device requests"

**Cause:** Container hasn't tried to connect yet

**Fix:**
1. Restart Railway container
2. Wait 10 seconds
3. Run `GET /api/devices` again

### Issue: Device ID changes after redeploy

**Cause:** `/data/.openclaw/device.id` not persisting

**Fix:**
1. Check Railway volume is mounted at `/data`
2. Check logs for: `[gateway] Using existing device ID` (should say "existing", not "new")

### Issue: Still getting "pairing required" after approval

**Cause:** Gateway hasn't reconnected yet

**Fix:**
1. Wait 30 seconds for gateway to reconnect
2. Or restart container to force reconnection
3. Check status again

---

## 📖 Full Documentation

- **[DEVICE-PAIRING-GUIDE.md](DEVICE-PAIRING-GUIDE.md)** - Complete guide
- **[DEVICE-PAIRING-FIX-SUMMARY.md](DEVICE-PAIRING-FIX-SUMMARY.md)** - Technical details
- **[API.md](API.md)** - API reference

---

## ✅ Success Checklist

- [ ] Device status shows `deviceIdPersisted: true`
- [ ] Device approved via API or CLI
- [ ] Skill installation returns 200 (or 429 rate limit, which is OK)
- [ ] Skill installation from chat works
- [ ] Device ID persists after container restart

---

## 🆘 Still Having Issues?

1. Check Railway logs for `[gateway]` messages
2. Verify `WRAPPER_API_KEY` is set correctly
3. Ensure `/data` volume is mounted
4. See troubleshooting section in [DEVICE-PAIRING-GUIDE.md](DEVICE-PAIRING-GUIDE.md)
