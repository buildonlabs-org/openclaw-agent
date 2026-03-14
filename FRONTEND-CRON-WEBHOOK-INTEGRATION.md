# Frontend Integration: Automatic Cron Webhook Configuration

## Problem Solved

When your frontend creates cron jobs via `/api/chat`, they need webhook delivery configured automatically so notifications appear in the launcher UI.

## Solution Overview

**Two approaches:**
1. ✅ **Recommended:** Frontend includes webhook instructions in chat messages
2. ✅ **Automatic:** Agent instructions (.agent.md) teach the agent to always add webhooks

Both are now implemented!

## Approach 1: Frontend Template (Quick & Reliable)

### Step 1: Get the Webhook URL

```javascript
// One-time call when initializing the agent connection
const response = await fetch(`${agentUrl}/api/cron/webhook-url`, {
  headers: {
    'Authorization': `Bearer ${apiKey}`
  }
});

const { webhookUrl } = await response.json();
// Store this for cron job creation
// Example: "https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook"
```

### Step 2: Include Webhook in Cron Creation Messages

When a user wants to create a cron job, append webhook instructions:

```javascript
async function createCronJob(userRequest, agentUrl, apiKey, webhookUrl) {
  const message = `${userRequest}

IMPORTANT: Configure this cron job with webhook delivery to ${webhookUrl} so the launcher UI receives completion notifications.`;

  const response = await fetch(`${agentUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message })
  });

  return response.json();
}
```

### Example Usage

```javascript
// User input: "Monitor $HYPE price every minute"
await createCronJob(
  "Monitor $HYPE price every minute",
  "https://polymarket-trader-production-7c0d.up.railway.app",
  "c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9",
  "https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook"
);

// Agent receives:
// "Monitor $HYPE price every minute
//
// IMPORTANT: Configure this cron job with webhook delivery to 
// https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook 
// so the launcher UI receives completion notifications."
```

## Approach 2: Agent Instructions (Automatic)

The agent now has custom instructions in `.agent.md` that automatically configure webhook delivery for all cron jobs.

**What it does:**
- When user says "create a cron job...", agent automatically adds `--webhook --webhook-url ...`
- Works for any cron-related request
- No changes needed in frontend code

**Verification:**
```bash
# Test that agent adds webhook automatically
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "create a cron job that checks market status every 5 minutes"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

Then verify the job was created with webhook delivery:
```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "show me the delivery configuration for the last cron job created"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

## Complete Frontend Example

```javascript
// Initialize agent connection
class AgentCronManager {
  constructor(agentUrl, apiKey) {
    this.agentUrl = agentUrl;
    this.apiKey = apiKey;
    this.webhookUrl = null;
  }

  async initialize() {
    // Get webhook URL once
    const response = await fetch(`${this.agentUrl}/api/cron/webhook-url`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    const data = await response.json();
    this.webhookUrl = data.webhookUrl;
    console.log(`Agent webhook URL: ${this.webhookUrl}`);
  }

  async createCronJob(userRequest) {
    // Template includes webhook instructions
    const message = `${userRequest}

IMPORTANT: Configure this cron job with webhook delivery to ${this.webhookUrl} so completion notifications are sent to the launcher UI.`;

    const response = await fetch(`${this.agentUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message })
    });

    return response.json();
  }

  async listCronJobs() {
    const response = await fetch(`${this.agentUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        message: 'list all openclaw cron jobs with their delivery configuration' 
      })
    });

    return response.json();
  }
}

// Usage
const manager = new AgentCronManager(
  'https://polymarket-trader-production-7c0d.up.railway.app',
  'c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9'
);

await manager.initialize();

// User creates cron job through UI
const result = await manager.createCronJob("Monitor $HYPE price every minute");
console.log(result.response);

// List all jobs
const jobs = await manager.listCronJobs();
console.log(jobs.response);
```

## Recommendation

**Use both approaches together:**

1. ✅ **Agent instructions (.agent.md)** - Provides a safety net, agent knows to add webhooks
2. ✅ **Frontend template** - Ensures it always works even if agent instructions miss it

This way:
- Even if frontend forgets to include webhook instructions, agent will add them
- Even if agent instructions don't work perfectly, frontend template ensures they're added
- Double redundancy = reliable notifications every time

## Testing

### Test 1: Frontend Template Approach
```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a test cron job that runs every 2 minutes. IMPORTANT: Configure with webhook delivery to https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

### Test 2: Agent Instructions (Automatic)
```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a test cron job that runs every 2 minutes"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

Both should create jobs with webhook delivery configured!

### Test 3: Verify Webhook URL Endpoint
```bash
curl -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  https://polymarket-trader-production-7c0d.up.railway.app/api/cron/webhook-url
```

Expected response:
```json
{
  "ok": true,
  "webhookUrl": "https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook",
  "instructions": "Use this URL when creating OpenClaw cron jobs to enable frontend notifications",
  "example": "openclaw cron add --name \"My Job\" --cron \"0 * * * *\" --message \"Do something\" --webhook --webhook-url \"https://...\""
}
```

## Summary

✅ **Agent instructions** ensure webhooks are always added  
✅ **Frontend template** provides explicit control  
✅ **Webhook URL endpoint** makes it easy to get the right URL  
✅ **Enhanced logging** helps debug any issues  

Your cron jobs will now automatically send notifications to the launcher UI! 🎉
