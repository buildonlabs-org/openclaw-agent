# 🔧 Fix Cron Notifications Not Reaching Frontend

## Your Configuration

- **Wrapper API Key**: `a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087`
- **Frontend Webhook URL**: `https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/6df09d45-d8d8-42ba-a00a-74283c383488`
- **Agent Token**: `6a1e32d38ed3d5b3093a101739932aa08cf0561135c5baba5775743c0474e04e`

## The Problem

Your cron jobs are running on Railway, but notifications aren't reaching your frontend webhook. This happens because **the environment variables that tell the agent WHERE to send notifications are not set**.

## The Solution

### Step 1: Set Environment Variables on Railway

1. Go to your Railway project dashboard
2. Select your OpenClaw agent service
3. Go to the **Variables** tab
4. Add these two environment variables:

```bash
LAUNCHER_WEBHOOK_URL=https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/6df09d45-d8d8-42ba-a00a-74283c383488

LAUNCHER_AGENT_TOKEN=6a1e32d38ed3d5b3093a101739932aa08cf0561135c5baba5775743c0474e04e
```

4. **Save** and **redeploy** your service (Railway will automatically redeploy when you add variables)

### Step 2: Verify Configuration

After the service redeploys, check if notifications are configured:

```bash
# Replace YOUR_RAILWAY_URL with your actual deployment URL
curl -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://YOUR_RAILWAY_URL/api/notifications/status
```

**Expected response:**
```json
{
  "ok": true,
  "configured": true,
  "webhook": {
    "url": "[configured]",
    "tokenSet": true
  }
}
```

If `configured: true`, you're good! ✅

### Step 3: Test Notification Delivery

Send a test notification:

```bash
curl -X POST \
  -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "info",
    "title": "Test Notification",
    "message": "Testing notification delivery"
  }' \
  https://YOUR_RAILWAY_URL/api/notifications/test
```

This should appear in your frontend! If it does, continue to Step 4.

### Step 4: Ensure Cron Jobs Have Webhooks Configured

Your cron jobs need to be configured to send webhooks when they complete. There are two ways to fix this:

#### Option A: Auto-Fix All Cron Jobs (Recommended)

Run this single command to automatically configure webhooks for all existing cron jobs:

```bash
curl -X POST \
  -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://YOUR_RAILWAY_URL/api/cron/audit-webhooks
```

This will:
- List all your cron jobs
- Check if they have webhook delivery configured
- Automatically fix any that don't
- Report the results

#### Option B: Configure Individual Cron Jobs

If you prefer to configure jobs manually:

1. **List your cron jobs:**

```bash
curl -X POST \
  -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  -H "Content-Type: application/json" \
  -d '{"message": "run: openclaw cron list --json"}' \
  https://YOUR_RAILWAY_URL/api/chat
```

2. **For each cron job without a webhook, remove and recreate it with webhook delivery:**

```bash
# First, get the webhook URL
curl -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://YOUR_RAILWAY_URL/api/cron/webhook-url
```

This will return something like:
```json
{
  "webhookUrl": "https://YOUR_RAILWAY_URL/api/openclaw-cron-webhook"
}
```

3. **Recreate the cron job with webhook delivery:**

Ask the agent to recreate the cron job:

```bash
curl -X POST \
  -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "remove the cron job named JOB_NAME, then create a new one with the same schedule that sends webhooks to https://YOUR_RAILWAY_URL/api/openclaw-cron-webhook when it completes"
  }' \
  https://YOUR_RAILWAY_URL/api/chat
```

### Step 5: Test End-to-End

Wait for your cron job to run (or trigger it manually if possible), and the notification should appear in your frontend!

You can also simulate a cron completion to test the full flow:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron.finished",
    "job": {
      "id": "test-123",
      "name": "Test Cron Job",
      "schedule": "*/5 * * * *"
    },
    "run": {
      "status": "completed",
      "summary": "Job completed successfully",
      "startedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "endedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "duration": 2.5
    }
  }' \
  https://YOUR_RAILWAY_URL/api/openclaw-cron-webhook
```

This simulates what OpenClaw sends when a cron job completes. The notification should appear in your frontend immediately!

## Troubleshooting

### Still not working?

1. **Check Railway logs:**
   - Look for `[notification]` log entries
   - Look for `[cron-webhook]` log entries
   - Check for errors or failed webhook deliveries

2. **Verify frontend webhook is reachable:**

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Agent-Token: 6a1e32d38ed3d5b3093a101739932aa08cf0561135c5baba5775743c0474e04e" \
  -d '{
    "type": "info",
    "title": "Direct Test",
    "message": "Testing direct webhook access"
  }' \
  https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/6df09d45-d8d8-42ba-a00a-74283c383488
```

This tests if your frontend webhook URL can receive notifications directly.

3. **Check for rate limiting:**
   - The agent limits notifications to 100 per hour
   - Check status endpoint for rate limit info

4. **Verify the webhook URL in your environment variables:**
   - Make sure there are no extra spaces
   - Make sure the URL is correct and includes the full path
   - Ensure the agent token matches what's expected by the frontend

## Quick Reference

### Check Notification Status
```bash
curl -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://YOUR_RAILWAY_URL/api/notifications/status
```

### Send Test Notification
```bash
curl -X POST \
  -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  -H "Content-Type: application/json" \
  -d '{"type":"info","title":"Test","message":"Test message"}' \
  https://YOUR_RAILWAY_URL/api/notifications/test
```

### Auto-Fix All Cron Jobs
```bash
curl -X POST \
  -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://YOUR_RAILWAY_URL/api/cron/audit-webhooks
```

### Get Webhook URL for Cron Jobs
```bash
curl -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://YOUR_RAILWAY_URL/api/cron/webhook-url
```

---

**Remember**: Replace `YOUR_RAILWAY_URL` with your actual Railway deployment URL (e.g., `https://your-service.up.railway.app`)
