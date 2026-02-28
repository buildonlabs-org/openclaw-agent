# Test: Update Channels Without Full Reconfigure

## Prerequisites
- Agent must be configured first: `POST /api/configure`

## Test 1: Update Telegram Token Only

```bash
# Get current config
curl -s http://localhost:8080/api/config/current \
  -H "Authorization: Bearer YOUR_API_KEY" | jq

# Update just the Telegram token
curl -s -X POST http://localhost:8080/api/channels/update \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "telegram": {
      "token": "NEW_TELEGRAM_BOT_TOKEN"
    }
  }' | jq

# Verify: Check status
curl -s http://localhost:8080/api/status \
  -H "Authorization: Bearer YOUR_API_KEY" | jq '.gateway'
```

## Test 2: Add Discord While Keeping Telegram

```bash
# Add Discord without touching Telegram or LLM config
curl -s -X POST http://localhost:8080/api/channels/update \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "discord": {
      "token": "DISCORD_BOT_TOKEN"
    }
  }' | jq
```

## Test 3: Update Both Channels

```bash
curl -s -X POST http://localhost:8080/api/channels/update \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "telegram": {
      "token": "NEW_TELEGRAM_TOKEN",
      "dmPolicy": "open"
    },
    "discord": {
      "token": "NEW_DISCORD_TOKEN"
    }
  }' | jq
```

## How It Works

1. **No Reset Required**: Uses `openclaw config set --json channels.telegram` directly
2. **Gateway Restarts**: Automatically restarts to load new channel config
3. **LLM Config Untouched**: Your AI provider, model, and API key remain unchanged
4. **Same Pattern**: Uses the exact same OpenClaw CLI commands as the configure endpoint

## Expected Output

```json
{
  "ok": true,
  "output": "Telegram config updated (exit=0)\n\nRestarting gateway...\nGateway restarted successfully\n",
  "message": "Channel configuration updated successfully"
}
```

## What Gets Updated

The endpoint updates the config file at `/data/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "dmPolicy": "pairing",
      "botToken": "NEW_TOKEN_HERE",
      "groupPolicy": "allowlist",
      "streamMode": "partial"
    }
  }
}
```

Everything else in the config remains unchanged.
