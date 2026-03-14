# Fix OpenClaw Cron Jobs to Send Webhooks

## Problem Confirmed

✅ **Webhook endpoint works** - Manual test succeeded
✅ **Agent forwards to frontend** - Notification delivered correctly
❌ **Cron jobs don't send webhooks** - They're not configured to do so

## Solution: Configure Cron Jobs for Webhook Delivery

### Step 1: List Current Cron Jobs

```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "run the command: openclaw cron list --json"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

This will show you all configured cron jobs and their delivery settings.

**Look for:** Each job should have a `delivery` section. If missing or set to `"mode": "none"`, webhooks won't be sent.

### Step 2: Update Existing Cron Jobs

For each cron job that needs webhook notifications, you need to update its delivery configuration.

#### Option A: Via OpenClaw CLI (through agent chat)

Ask the agent to update the cron job:

```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "update the cron job named \"<JOB_NAME>\" to send webhooks to https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook when it completes"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

#### Option B: Remove and Recreate with Webhook

If updating doesn't work, remove the old job and create a new one with webhook delivery:

```bash
# 1. Ask agent to list the job details first
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "show me the full configuration of the cron job named \"<JOB_NAME>\""}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat

# 2. Ask agent to recreate it with webhook delivery
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "create a cron job with the same settings as before but add webhook delivery to https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

### Step 3: Create New Cron Jobs with Webhook Delivery

When creating new cron jobs, always include webhook configuration:

#### Via Agent Chat (Recommended):

```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "create a cron job named \"My Job\" that runs every hour with the message \"do something\" and sends webhook notifications to https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook when it completes"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

#### Via OpenClaw CLI Command (through agent):

```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "run this command: openclaw cron add --name \"My Job\" --cron \"0 * * * *\" --message \"do something\" --webhook --webhook-url https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

### Step 4: Verify the Configuration

After updating, verify the job has webhook delivery:

```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "show me the delivery configuration for cron job \"<JOB_NAME>\""}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

**Expected output should include:**
```json
{
  "delivery": {
    "mode": "webhook",
    "to": "https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook"
  }
}
```

### Step 5: Wait for Next Execution

Once configured, the cron job will send a webhook when it next completes. You should see:

1. **In Railway logs:**
   ```
   [cron-webhook] Received payload: {type: "cron.finished", ...}
   [notification] sending cron: <Job Name>
   [notification] webhook success: 200
   ```

2. **In frontend UI:**
   - Notification appears with job name and status
   - Saved to database
   - Shows duration, status, etc.

## Quick Reference: Webhook URL

Use this URL when configuring cron jobs:
```
https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook
```

## Example: Full Cron Job Creation

```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Create a cron job with these settings:\n- Name: Daily Summary\n- Schedule: Every day at 9am UTC (cron: 0 9 * * *)\n- Message: Summarize yesterday activity and list top priorities for today\n- Webhook: Send completion notifications to https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook\n- Session: isolated"
  }' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

## Troubleshooting

### Issue: "Can't update cron job delivery"
Some OpenClaw versions may not support updating delivery config. In this case:
1. Delete the old job
2. Recreate it with webhook delivery

### Issue: "Webhook URL too long"
If the CLI rejects the URL, use a shortened version or store it in an environment variable.

### Issue: Still no notifications after configuration
1. Verify the job has `"mode": "webhook"` in its config
2. Wait for the next scheduled execution
3. Manually trigger the job to test immediately:
   ```bash
   curl -X POST \
     -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
     -H "Content-Type: application/json" \
     -d '{"message": "trigger the cron job \"<JOB_NAME>\" to run now"}' \
     https://polymarket-trader-production-7c0d.up.railway.app/api/chat
   ```

## Summary

The notification system is working perfectly. You just need to configure your cron jobs to send webhooks when they complete. Use the commands above to:

1. ✅ List current jobs
2. ✅ Update them to use webhook delivery
3. ✅ Verify the configuration
4. ✅ Wait for next execution or trigger manually
5. ✅ See notifications in the frontend!
