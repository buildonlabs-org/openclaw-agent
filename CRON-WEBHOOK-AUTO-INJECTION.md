# Automatic Cron Webhook Configuration

## How It Works

The agent **automatically** configures cron jobs with webhook delivery. Frontends don't need to do anything special!

## Two-Layer Safety System

### Layer 1: Pre-Injection (Proactive)
**When**: Before sending the message to OpenClaw  
**What**: Detects cron job creation requests and automatically injects webhook configuration  
**Languages**: English, Spanish, French, German, Portuguese, Italian, Chinese

```javascript
// User message:
"Create a cron job to check Polymarket every minute"

// Automatically becomes:
"Create a cron job to check Polymarket every minute

When creating this cron job, configure it with webhook delivery mode and set the webhook URL to: https://your-agent.railway.app/api/openclaw-cron-webhook

This ensures completion notifications are sent to the launcher UI."
```

**Triggers on messages like:**
- English: "create a cron job...", "send me updates every hour", "keep me updated"
- Spanish: "cada minuto", "enviar notificaciones cada día", "mantenerme actualizado"
- French: "chaque minute", "envoyer des mises à jour", "me tenir au courant"
- German: "jede Minute", "benachrichtigen", "mich auf dem Laufenden halten"
- Portuguese: "cada minuto", "enviar atualizações", "me manter atualizado"
- Italian: "ogni minuto", "inviare notifiche", "tenermi aggiornato"
- Chinese: "每分钟", "定时", "每天"

### Layer 2: Post-Verification (Safety Net)
**When**: After the chat response is received  
**What**: Checks all cron jobs and automatically fixes any that don't have webhook delivery  
**Languages**: ALL (works regardless of language used)

```javascript
// After every chat message, the system:
1. Lists all cron jobs
2. Checks each one for webhook delivery
3. Automatically adds webhook configuration to any missing it
4. Returns count of fixed jobs in response
```

**Important**: Even if Layer 1 doesn't detect the request (e.g., unsupported language or unusual phrasing), Layer 2 will always catch and fix the cron job after creation. This ensures 100% webhook coverage!

## Frontend Requirements

### ✅ What You Need to Do

**Nothing special!** Just send cron job requests normally:

```typescript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: "Create a cron job that checks Polymarket every 5 minutes"
  })
});

const data = await response.json();

// Cron job is automatically configured with webhooks!
// Notifications will flow: OpenClaw → Agent → Your Frontend
```

### ❌ What You DON'T Need to Do

- ❌ Don't add "with webhook notifications" to messages
- ❌ Don't specify webhook URLs
- ❌ Don't call any special endpoints
- ❌ Don't configure anything manually

### Optional: Show Fixed Count

The response includes `cronJobsFixed` field:

```json
{
  "ok": true,
  "response": "I've created the cron job...",
  "cronDetected": true,
  "cronJobsFixed": 0
}
```

- `cronJobsFixed: 0` = job was created correctly with webhooks
- `cronJobsFixed: 1+` = job was created but had to be fixed (rare)

You can optionally show this to users:

```typescript
if (data.cronJobsFixed > 0) {
  console.log(`✅ Configured ${data.cronJobsFixed} cron job(s) for notifications`);
}
```

## Example User Flow

### User's Perspective (Simple!)

**Example 1: Natural language**
1. User: "Send me the 2028 election odds on Polymarket every minute"
2. Agent: "I've set up a cron job to check Polymarket every minute."
3. ✅ Notifications automatically appear in UI when job completes

**Example 2: Monitoring**
1. User: "Monitor Bitcoin price for me and alert if it changes"
2. Agent: "Created! You'll get notifications about Bitcoin price changes."
3. ✅ Notifications automatically appear when conditions are met

**Example 3: Explicit cron**
1. User: "Create a cron job to check markets every hour"
2. Agent: "Done! The job will run hourly and send notifications."
3. ✅ Notifications flow automatically

### Behind the Scenes

1. Frontend sends message to `/api/chat`
2. Agent detects it's a cron request
3. Agent injects webhook configuration into message
4. OpenClaw creates job with webhook delivery
5. Agent verifies webhook is configured (safety net)
6. Cron jobs run and send webhooks automatically
7. Agent receives webhook at `/api/openclaw-cron-webhook`
8. Agent forwards to frontend at `LAUNCHER_WEBHOOK_URL`
9. Frontend displays notification

## Troubleshooting

### Notifications still not appearing?

**Check environment variables are set on Railway:**
```bash
LAUNCHER_WEBHOOK_URL=https://your-frontend.app/api/notifications/webhook/...
LAUNCHER_AGENT_TOKEN=your-agent-token
```

**Verify configuration:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/notifications/status

# Should return: "configured": true
```

**Check cron jobs have webhooks:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/cron/jobs

# Each job should have: "webhookConfigured": true
```

**Manually fix if needed:**
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/cron/audit-webhooks
```

## Benefits

✅ **Zero Frontend Work** - Users just create cron jobs normally  
✅ **Automatic Configuration** - Webhooks are auto-configured  
✅ **Safety Net** - Post-verification catches edge cases  
✅ **Transparent** - Works without user awareness  
✅ **Reliable** - Two layers ensure webhooks are configured  

## Detection Patterns

The system detects cron requests from **70+ natural language patterns**:

### 🎯 Action Verbs with "Every"
- **"send me ... every [time]"** → "send me the election odds every minute"
- **"notify me ... every [time]"** → "notify me about changes every hour"
- **"alert me ... every [time]"** → "alert me when price changes every day"
- **"check ... every [time]"** → "check the weather every 5 minutes"
- **"monitor ... every [time]"** → "monitor bitcoin every hour"
- **"update me ... every [time]"** → "update me on stocks every morning"
- **Also works with:** tell, inform, ping, message, email, text, track, watch, scan, poll, query, fetch, get, pull, retrieve, report, show, give, provide, share

### 💬 "Keep Me" Patterns
- **"keep me updated"** → "keep me updated on the election"
- **"keep me informed"** → "keep me informed about price changes"
- **"keep me posted"** → "keep me posted every hour"
- **"keep track of"** → "keep track of bitcoin for me"
- **"keep an eye on"** → "keep an eye on polymarket odds"
- **"keep tabs on"** → "keep tabs on the price"

### 🔔 "Let Me Know" Patterns
- **"let me know ... every"** → "let me know if the price changes every minute"
- **"let me know ... regularly"** → "let me know about updates regularly"
- **"inform me ... every"** → "inform me every hour about changes"

### 👀 Monitoring/Watching Language
- **"monitor ... for me"** → "monitor bitcoin price for me"
- **"watch for changes"** → "watch for price changes"
- **"watch out for updates"** → "watch out for market updates"
- **"stay on top of"** → "stay on top of election odds"
- **"stay informed"** → "stay informed about the markets"
- **"follow ... closely"** → "follow bitcoin prices closely"
- **"observe ... continuously"** → "observe the market continuously"

### 🙋 "I Want/Need" Patterns
- **"I want updates every [time]"** → "I want updates every hour"
- **"I need to check ... daily"** → "I need to check prices daily"
- **"I would like notifications every [time]"** → "I would like notifications every minute"
- **"I want to monitor ... regularly"** → "I want to monitor this regularly"

### ⏰ Time-Based Patterns
- **At specific times:** "check at 9am every day", "send updates at 3:30pm"
- **Time of day:** "every morning", "every evening", "every night", "every noon"
- **Frequency words:** "daily", "hourly", "weekly", "monthly"
  - "check daily at 9am"
  - "send updates hourly"
  - "notify me weekly"

### 📅 Frequency Adverbs
- **"regularly check"** → "regularly check the price for me"
- **"periodically send"** → "periodically send me updates"
- **"continuously monitor"** → "continuously monitor the market"
- **"constantly check"** → "constantly check for changes"
- **"repeatedly notify"** → "repeatedly notify me of updates"
- **"routinely check"** → "check prices routinely"

### ⚡ Interval Patterns
- **"at X intervals"** → "check at 5 minute intervals"
- **"on a X basis"** → "send updates on an hourly basis", "on a daily basis, check the odds"

### 🤖 Automation Language
- **"automate checking"** → "automate checking polymarket prices"
- **"set up automatic"** → "set up automatic price monitoring"
- **"set up automated"** → "set up automated updates every hour"
- **"create recurring"** → "create a recurring task to check prices"

### 🔔 Reminder Patterns
- **"remind me every"** → "remind me every hour to check prices"
- **"set a reminder"** → "set a reminder every day at 9am"
- **"daily reminder"** → "daily reminder to check markets"

### 📝 Explicit Cron Language
- **"cron job"** → "create a cron job to check markets"
- **"add a cron"** → "add a cron job every 5 minutes"
- **"schedule a task"** → "schedule a task to run hourly"
- **"recurring task"** → "set up a recurring task"

### ✅ What Gets Captured
All these time expressions work:
- every **second, minute, hour, day, week, month, year**
- every **few minutes, couple hours, other day**
- each **minute, hour, day**
- at **9am, 3:30pm, 12:00**
- **daily, hourly, weekly, monthly**
- **regularly, periodically, continuously, constantly, repeatedly, routinely**

### ❌ What Doesn't Trigger (One-Time Requests)
These correctly do NOT trigger cron detection:
- "what's the weather today" ← one-time
- "check the price right now" ← immediate
- "send me the current odds" ← one-time
- "what time is it" ← not recurring
- "tell me about bitcoin" ← informational

See `detectCronRequest()` in [src/server.js](src/server.js) for full regex patterns.

## Summary

**For Frontends:**  
Just send normal cron creation messages. The agent handles everything else!

**For Users:**  
Create cron jobs naturally. Notifications just work! 🎉
