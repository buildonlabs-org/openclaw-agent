# Device Pairing Quick Start

## ✅ Fix Applied

Device pairing is now **enabled** in `src/gatewayClient.js`. This allows the agent to use skills through Telegram/Discord.

## 🚀 Setup Steps (One-Time)

### 1. Deploy/Restart the Agent

The agent needs to reconnect to the gateway with device pairing enabled:

```bash
# If running locally:
npm start

# If on Railway:
# Just redeploy or restart the container
```

### 2. Check Device Status

```bash
curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
  https://your-agent.railway.app/api/devices/status | jq '.'
```

You should see:
```json
{
  "ok": true,
  "deviceId": "abc123...",
  "pairingRequired": true
}
```

### 3. List Pending Devices

```bash
# Using API:
curl -H "Authorization: Bearer $WRAPPER_API_KEY" \
  https://your-agent.railway.app/api/devices | jq '.'

# Or using CLI on your gateway host:
openclaw devices list
```

You'll see something like:
```
abc123... - pending
```

### 4. Approve the Device

```bash
# Using API:
curl -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"requestId": "abc123..."}' \
  https://your-agent.railway.app/api/devices/approve

# Or using CLI on your gateway host:
openclaw devices approve abc123...
```

### 5. Verify It Works

Now try asking the agent through Telegram/Discord:

```
You: what skills do you have?
Agent: I have the following skills installed: ...
```

Or test with a skill:

```
You: use polymarket to check current markets
Agent: [uses polymarket skill successfully]
```

## 🔄 Persistence

- Device ID is stored in `/data/.openclaw/device.id`
- Once approved, the device stays approved
- No need to approve again after redeployments (as long as `/data` volume persists)

## 🛠️ Troubleshooting

### "No pending device request found"

The agent hasn't connected yet. Restart the agent and immediately run the list command.

### Agent still says "pairing required"

1. Check that the agent restarted after the code change
2. Verify device status shows `pairingRequired: true`
3. Check logs for `[gateway] Device pairing required...`
4. Make sure you approved the correct request ID

### How do I reset?

Delete `/data/.openclaw/device.id` and restart. A new device ID will be generated.

## 📖 Full Documentation

For more details, see:
- [DEVICE-PAIRING-GUIDE.md](DEVICE-PAIRING-GUIDE.md)
- [API.md](API.md) - Device endpoints reference
