# 🔔 OpenClaw Cron Job Notifications

## Overview

Your OpenClaw Agent now supports forwarding **OpenClaw cron job completions** to the launcher frontend via webhooks. When your cron jobs finish, users see real-time notifications in the launcher UI.

## How It Works

```
OpenClaw Gateway Cron System
    ↓ (delivery.mode = "webhook")
Agent Webhook Endpoint (/api/openclaw-cron-webhook)
    ↓ (extracts job info)
Launcher Frontend
    ↓
User sees notification in UI
```

## Setup

### 1. Your Agent Has a Webhook Endpoint

Your agent automatically provides:
- **Endpoint**: `https://your-agent.railway.app/api/openclaw-cron-webhook`
- **Purpose**: Receives OpenClaw cron `finished` events
- **Action**: Forwards to launcher webhook with job details

### 2. Configure Your Cron Jobs

When creating cron jobs, use `delivery.mode = "webhook"` and point to your agent's webhook endpoint.

## Examples

### CLI: Create a Recurring Cron Job with Webhook Delivery

```bash
# Get your agent's public URL
AGENT_URL="https://your-agent.railway.app"

# Create a cron job that posts to webhook on completion
openclaw cron add \
  --name "Morning Brief" \
  --cron "0 7 * * *" \
  --tz "America/Los_Angeles" \
  --session isolated \
  --message "Summarize overnight updates and priority tasks for today." \
  --webhook \
  --webhook-url "$AGENT_URL/api/openclaw-cron-webhook"
```

### Tool Call: Create Cron Job with Webhook Delivery

```json
{
  "name": "Daily Standup",
  "schedule": {
    "kind": "cron",
    "expr": "0 9 * * *",
    "tz": "America/New_York"
  },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Review yesterday's commits and today's sprint items.",
    "lightContext": true
  },
  "delivery": {
    "mode": "webhook",
    "to": "https://your-agent.railway.app/api/openclaw-cron-webhook"
  }
}
```

### One-Shot Reminder with Webhook

```bash
openclaw cron add \
  --name "Meeting Reminder" \
  --at "2026-03-15T14:00:00Z" \
  --session isolated \
  --message "Remind about the 2pm product review meeting." \
  --webhook \
  --webhook-url "https://your-agent.railway.app/api/openclaw-cron-webhook" \
  --delete-after-run
```

## What Gets Forwarded to Launcher

When your cron job completes, the agent forwards:

| Field | Description | Example |
|-------|-------------|---------|
| **Title** | Job name | "Morning Brief" |
| **Message** | Status + summary | "✅ Completed successfully" |
| **Data** | Job metadata | jobId, status, duration, schedule type |

### Notification Status Indicators

- ✅ **Success**: Job completed successfully
- ❌ **Error**: Job failed
- ⏭️ **Skipped**: Job was skipped

## Environment Variables

The launcher automatically sets these when deploying your agent:

```bash
LAUNCHER_WEBHOOK_URL=https://launcher.com/api/notifications/webhook/{serviceId}
LAUNCHER_AGENT_TOKEN=<unique-token-for-this-agent>
```

**No manual configuration needed!**

## Example Cron Jobs to Add

### 1. Daily Morning Brief

```bash
openclaw cron add \
  --name "Daily Morning Brief" \
  --cron "0 7 * * *" \
  --tz "America/Los_Angeles" \
  --session isolated \
  --message "Summarize: calendar events, unread emails, GitHub notifications, and top priorities." \
  --webhook \
  --webhook-url "https://your-agent.railway.app/api/openclaw-cron-webhook"
```

### 2. Hourly GitHub Activity Check

```bash
openclaw cron add \
  --name "GitHub Activity Check" \
  --cron "0 * * * *" \
  --session isolated \
  --message "Check for new GitHub issues, PRs, and mentions in my repos." \
  --light-context \
  --webhook \
  --webhook-url "https://your-agent.railway.app/api/openclaw-cron-webhook"
```

### 3. Weekly Report

```bash
openclaw cron add \
  --name "Weekly Report" \
  --cron "0 17 * * 5" \
  --tz "America/New_York" \
  --session isolated \
  --message "Generate weekly summary: tasks completed, commits made, issues resolved." \
  --webhook \
  --webhook-url "https://your-agent.railway.app/api/openclaw-cron-webhook"
```

### 4. Custom Session Tracking

```bash
openclaw cron add \
  --name "Project Monitor" \
  --cron "0 */6 * * *" \
  --session "session:project-alpha" \
  --message "Update project status and track progress." \
  --webhook \
  --webhook-url "https://your-agent.railway.app/api/openclaw-cron-webhook"
```

## Testing

### 1. Check Webhook Endpoint

```bash
# Your webhook endpoint is ready automatically
curl https://your-agent.railway.app/healthz
```

### 2. Create a Test Cron Job (runs in 5 minutes)

```bash
openclaw cron add \
  --name "Test Cron Job" \
  --at "5m" \
  --session isolated \
  --message "This is a test cron job notification." \
  --webhook \
  --webhook-url "https://your-agent.railway.app/api/openclaw-cron-webhook" \
  --delete-after-run
```

### 3. Force Run Immediately

```bash
# Get job ID from list
openclaw cron list

# Force run now
openclaw cron run <job-id>

# Check if it worked
openclaw cron runs --id <job-id>
```

### 4. Check Launcher UI

- Look for notification badge on your agent card
- Click badge to see the notification panel
- Filter by "Cron" type to see only cron notifications

## Managing Cron Jobs

```bash
# List all cron jobs
openclaw cron list

# View job details
openclaw cron status <job-id>

# Edit a job (change webhook URL)
openclaw cron edit <job-id> \
  --webhook-url "https://new-url.railway.app/api/openclaw-cron-webhook"

# Disable a job
openclaw cron edit <job-id> --enabled false

# Enable a job
openclaw cron edit <job-id> --enabled true

# Delete a job
openclaw cron remove <job-id>

# View run history
openclaw cron runs --id <job-id> --limit 20
```

## Webhook Payload Format

The OpenClaw Gateway sends this payload to `/api/openclaw-cron-webhook`:

```json
{
  "type": "cron.finished",
  "job": {
    "id": "job-123",
    "jobId": "job-123",
    "name": "Morning Brief",
    "schedule": {
      "kind": "cron",
      "expr": "0 7 * * *",
      "tz": "America/Los_Angeles"
    },
    "sessionTarget": "isolated",
    "enabled": true
  },
  "run": {
    "runId": "run-abc-123",
    "status": "success",
    "startedAt": "2026-03-14T15:00:00.000Z",
    "endedAt": "2026-03-14T15:00:15.234Z",
    "duration": 15234,
    "summary": "Completed successfully: Summarized 3 calendar events and 12 emails."
  }
}
```

The agent automatically extracts this info and forwards it to the launcher.

## Troubleshooting

### Notifications Not Appearing

1. **Check cron job configuration**:
   ```bash
   openclaw cron list
   openclaw cron status <job-id>
   ```
   
2. **Verify webhook URL is set**:
   ```json
   {
     "delivery": {
       "mode": "webhook",
       "to": "https://your-agent.railway.app/api/openclaw-cron-webhook"
     }
   }
   ```

3. **Check agent logs**:
   ```bash
   # Look for [cron-webhook] entries
   railway logs
   ```

4. **Test the webhook endpoint**:
   ```bash
   curl -X POST https://your-agent.railway.app/api/openclaw-cron-webhook \
     -H "Content-Type: application/json" \
     -d '{
       "type": "cron.finished",
       "job": {"id": "test", "name": "Test Job"},
       "run": {"status": "success", "summary": "Test successful"}
     }'
   ```

### Cron Job Not Running

1. **Check if cron is enabled**:
   ```bash
   openclaw config get cron.enabled
   ```

2. **Verify gateway is running**:
   ```bash
   ps aux | grep openclaw
   ```

3. **Check cron run history**:
   ```bash
   openclaw cron runs --id <job-id>
   ```

4. **Check for errors**:
   ```bash
   openclaw cron runs --id <job-id> --limit 5
   ```

### Wrong Timezone

```bash
# Edit job with correct timezone
openclaw cron edit <job-id> --tz "America/Los_Angeles"

# Or recreate with correct timezone
openclaw cron remove <job-id>
openclaw cron add ... --tz "America/Los_Angeles"
```

## Advanced Configuration

### Custom Webhook Token

If you want to secure the webhook endpoint with a token:

```bash
# In OpenClaw config
openclaw config set cron.webhookToken "your-secret-token"

# The webhook will include: Authorization: Bearer your-secret-token
```

Then update your agent's webhook endpoint to validate the token.

### Multiple Agents

Each agent has its own webhook endpoint:

```bash
# Agent 1
openclaw cron add ... --webhook-url "https://agent1.railway.app/api/openclaw-cron-webhook"

# Agent 2  
openclaw cron add ... --webhook-url "https://agent2.railway.app/api/openclaw-cron-webhook"
```

### Rate Limiting

The launcher webhook has a rate limit of **100 notifications per hour** per agent. If you have many frequent cron jobs, consider:

- Using longer intervals
- Batching updates (e.g., hourly summary instead of per-event)
- Using `lightContext: true` for faster execution

## Best Practices

1. **Use descriptive job names**: "Daily GitHub Summary" not "Cron Job 1"
2. **Set appropriate timezones**: Use `--tz` for local time schedules
3. **Use light context for simple jobs**: Add `--light-context` for faster execution
4. **Test before deploying**: Create with `--at "2m"` to test quickly
5. **Monitor run history**: Check `openclaw cron runs` regularly
6. **Clean up old jobs**: Remove jobs you're not using

## Summary

✅ **Webhook endpoint ready**: `/api/openclaw-cron-webhook`  
✅ **Configure cron jobs**: Use `--webhook --webhook-url`  
✅ **Launcher integration**: Automatic when env vars are set  
✅ **Real-time notifications**: Users see cron completions in UI  

For more on OpenClaw cron: https://docs.openclaw.ai/automation/cron-jobs
