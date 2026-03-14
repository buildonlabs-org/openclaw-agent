# Frontend Integration: Automatic Cron Webhook Configuration

## ✨ Zero-Configuration Solution

**The backend now handles everything automatically!**

When your frontend sends messages to `/api/chat`, the backend:
1. ✅ **Detects** if the message is about creating a cron job
2. ✅ **Automatically injects** webhook delivery instructions
3. ✅ **Uses** the agent's URL from Railway environment

**No changes needed in your frontend code!**

## How It Works

### Backend Detection

The `/api/chat` endpoint now includes automatic cron detection:

```javascript
// Backend automatically detects patterns like:
- "create a cron job..."
- "schedule a task that runs every..."
- "set up a reminder for..."
- "monitor X every 5 minutes"
- "daily at 9am..."
```

When detected, it automatically appends:
```
IMPORTANT: Configure this cron job with webhook delivery to 
https://your-agent.railway.app/api/openclaw-cron-webhook 
so completion notifications are sent to the launcher UI.
```

### Frontend Usage (No Changes Required!)

Your existing frontend code just works:

```javascript
// This is all you need - backend handles the rest!
const response = await fetch(`${agentUrl}/api/chat`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: "Monitor $HYPE price every minute"
  })
});

const data = await response.json();
// data.cronDetected will be true if cron was detected
console.log('Cron detected:', data.cronDetected);
```

That's it! The backend automatically adds webhook configuration.

## Detection Patterns

The backend detects cron requests when messages contain:
- `cron job`, `cron add`
- `schedule a task`, `schedule a job`
- `recurring task`, `automated task`
- `set a reminder`
- `runs every`, `every X minutes/hours/days`
- `daily at`, `hourly`, `weekly`
- Time patterns like `at 9am`

## Response Field

The API response includes a `cronDetected` field:

```json
{
  "ok": true,
  "agentId": "main",
  "sessionKey": "api-session-123",
  "response": "I've created a cron job...",
  "timestamp": "2026-03-14T18:00:00.000Z",
  "cronDetected": true
}
```

Use this to show special UI feedback like "⏰ Cron job configured with notifications enabled"

## Optional: Manual Override

If you want to explicitly control webhook delivery, include "webhook" in your message:

```javascript
// Explicitly mention webhook - backend won't inject (avoids duplication)
body: JSON.stringify({
  message: "Create a cron job... with webhook delivery to https://custom-url/webhook"
})
```

## Migration from Old Approach

### Before (Old Approach - Required Frontend Changes)
```javascript
// Old: Frontend had to know about webhooks
const webhookUrl = await getWebhookUrl();
const message = `${userRequest}

IMPORTANT: Configure with webhook delivery to ${webhookUrl}...`;
```

### After (New Approach - Zero Changes)
```javascript
// New: Just send the message as-is
const response = await fetch(`${agentUrl}/api/chat`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: userRequest  // ✨ That's it!
  })
});
```

## Complete Example

```javascript
class AgentChat {
  constructor(agentUrl, apiKey) {
    this.agentUrl = agentUrl;
    this.apiKey = apiKey;
  }

  async sendMessage(message, sessionKey = null) {
    const response = await fetch(`${this.agentUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message, sessionKey })
    });

    const data = await response.json();
    
    // Optional: Show special UI for cron jobs
    if (data.cronDetected) {
      console.log('⏰ Cron job detected - notifications enabled automatically');
    }
    
    return data;
  }
}

// Usage
const chat = new AgentChat(
  'https://polymarket-trader-production-7c0d.up.railway.app',
  'c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9'
);

// Creates cron with webhook automatically!
await chat.sendMessage("Monitor $HYPE price every minute");

// Regular chat - no cron detection
await chat.sendMessage("What's the current price?");
```

## Testing

### Test 1: Automatic Detection (Recommended)
```bash
# Just send a normal cron request - backend handles the rest!
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a test cron job that runs every 2 minutes"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

Check the response for `cronDetected: true` and verify the cron job was created with webhook delivery.

### Test 2: Various Cron Patterns
```bash
# Monitor pattern
curl -X POST -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" -H "Content-Type: application/json" -d '{"message": "Monitor $HYPE price every minute"}' https://polymarket-trader-production-7c0d.up.railway.app/api/chat

# Schedule pattern
curl -X POST -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" -H "Content-Type: application/json" -d '{"message": "Schedule a task that runs daily at 9am"}' https://polymarket-trader-production-7c0d.up.railway.app/api/chat

# Reminder pattern
curl -X POST -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" -H "Content-Type: application/json" -d '{"message": "Set a reminder to check positions every hour"}' https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

All should return `cronDetected: true` and create jobs with webhook delivery!

### Test 3: Verify in Railway Logs
After creating a cron job, check Railway logs within 60 seconds:
```
[api/chat] Detected cron request, injecting webhook URL: https://...
[api/chat] Injected webhook instructions
```

Then when the cron runs:
```
[cron-webhook] Received payload: {...}
[notification] webhook success: 200
```

## Advanced: Webhook URL Endpoint (Optional)

If you need to get the webhook URL for other purposes:

```bash
curl -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  https://polymarket-trader-production-7c0d.up.railway.app/api/cron/webhook-url
```

Response:
```json
{
  "ok": true,
  "webhookUrl": "https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook",
  "instructions": "Use this URL when creating OpenClaw cron jobs...",
  "example": "openclaw cron add --webhook --webhook-url \"https://...\""
}
```

## Summary

✅ **Zero frontend changes required** - Backend handles everything  
✅ **Automatic detection** - Recognizes cron patterns in messages  
✅ **Smart injection** - Only adds webhook if not already mentioned  
✅ **Detection feedback** - `cronDetected` field in response  
✅ **Works immediately** - No deployment needed on frontend  

Your cron jobs will now automatically send notifications to the launcher UI! 🎉

## How This Works Behind the Scenes

1. **Frontend sends message**: `"Monitor $HYPE price every minute"`
2. **Backend detects cron pattern**: Matches "every minute"
3. **Backend injects webhook**: Appends webhook instructions
4. **Gateway receives enhanced message**: Creates cron with webhook delivery
5. **Cron runs**: Sends webhook to `/api/openclaw-cron-webhook`
6. **Agent forwards to launcher**: Uses `LAUNCHER_WEBHOOK_URL` and `LAUNCHER_AGENT_TOKEN`
7. **Frontend displays notification**: User sees cron completion in UI

All automatic! 🚀
