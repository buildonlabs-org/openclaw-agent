# 🔍 OpenClaw Cron Notification Troubleshooting Guide

## Problem: Cron events not appearing in frontend

Your cron jobs are running in OpenClaw, but notifications aren't showing up in the launcher UI, even though direct webhook tests work.

## Quick Diagnosis

### Step 1: Verify Environment Variables on Railway

The agent needs these environment variables set on Railway:

```bash
LAUNCHER_WEBHOOK_URL=https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/79581172-b5f2-477f-a88b-c12c9c745f25
LAUNCHER_AGENT_TOKEN=e03d30cf0f7b7604bc81ac0cb670f8d784d203149b375df616c600e3fbac2acb
```

**How to check:**

```bash
# Check if notification system is configured
curl -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  https://polymarket-trader-production-7c0d.up.railway.app/api/notifications/status
```

**Expected response:**
```json
{
  "ok": true,
  "configured": true,
  "webhook": {
    "url": "[configured]",
    "tokenSet": true
  },
  "rateLimit": {
    "count": 0,
    "limit": 100,
    "remaining": 100
  }
}
```

If `configured: false`, the environment variables are **NOT set** on Railway.

### Step 2: Test Notification Delivery

Send a test notification through the agent:

```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"type": "cron", "title": "Test Notification", "message": "Testing delivery"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/notifications/test
```

**Expected response:**
```json
{
  "ok": true,
  "message": "Test notification sent successfully",
  "type": "cron",
  "title": "Test Notification",
  "sent": true
}
```

✅ **If this works**, check the frontend UI for the notification.
❌ **If this fails**, check Railway logs for errors.

### Step 3: Test OpenClaw Cron Webhook Endpoint

Simulate an OpenClaw cron completion event:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron.finished",
    "job": {
      "id": "test-job-123",
      "name": "Test Cron Job",
      "schedule": {"kind": "cron", "expr": "*/5 * * * *"}
    },
    "run": {
      "status": "success",
      "summary": "Test completed successfully",
      "startedAt": "2026-03-14T10:00:00Z",
      "endedAt": "2026-03-14T10:00:05Z",
      "duration": 5000
    }
  }' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook
```

**Expected response:**
```json
{
  "ok": true,
  "received": true,
  "notificationSent": true
}
```

If `notificationSent: false`, check Railway logs for webhook errors.

### Step 4: Check Railway Logs

The enhanced logging will show:

```
[notification] webhook configured and ready
[cron-webhook] Received payload: {...}
[cron-webhook] Forwarding notification: Test Cron Job [success]
[notification] sending cron: Test Cron Job
[notification] webhook URL: https://laughing-pancake...
[notification] webhook success: 200 {"ok":true}
[cron-webhook] ✅ Successfully forwarded cron job: Test Cron Job [success]
```

**If you see errors:**

- **Timeout errors**: Frontend is taking too long to respond (>5s)
- **404/403 errors**: Wrong webhook URL or token
- **Network errors**: Connectivity issue between Railway and GitHub Codespaces
- **CORS errors**: Should not happen with webhook requests

## Common Issues & Solutions

### Issue 1: Environment variables not set

**Symptom:** `configured: false` in status check

**Solution:**
1. Go to Railway dashboard → Your service → Variables
2. Add `LAUNCHER_WEBHOOK_URL` and `LAUNCHER_AGENT_TOKEN`
3. Redeploy the service

### Issue 2: Wrong webhook URL format

**Symptom:** 404 errors in logs

**Solution:**
Verify the webhook URL is **exactly**:
```
https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/79581172-b5f2-477f-a88b-c12c9c745f25
```

No trailing slashes, correct service ID.

### Issue 3: Wrong token

**Symptom:** 401/403 errors in logs

**Solution:**
Verify the token is **exactly**:
```
e03d30cf0f7b7604bc81ac0cb670f8d784d203149b375df616c600e3fbac2acb
```

### Issue 4: GitHub Codespaces networking

**Symptom:** Timeout or connection refused errors

**Solution:**
GitHub Codespaces URLs are only accessible when the codespace is running. If the frontend is in a codespace:
1. Verify the codespace is running
2. Check if the port 3000 is publicly accessible
3. Try regenerating the codespace URL if it changed

### Issue 5: Cron jobs not configured for webhook delivery

**Symptom:** Cron jobs run but webhook endpoint never receives payloads

**Solution:**
When creating OpenClaw cron jobs, you **must** configure webhook delivery:

```bash
openclaw cron add \
  --name "My Cron Job" \
  --cron "0 * * * *" \
  --message "Do something" \
  --webhook \
  --webhook-url "https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook"
```

Or via API:
```json
{
  "delivery": {
    "mode": "webhook",
    "to": "https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook"
  }
}
```

**List existing cron jobs** to verify:
```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "run: openclaw cron list"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

### Issue 6: Rate limiting

**Symptom:** Notifications stop after many are sent

**Solution:**
The agent limits to 100 notifications per hour. Check rate limit status:

```bash
curl -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  https://polymarket-trader-production-7c0d.up.railway.app/api/notifications/status
```

If `remaining: 0`, wait for the window to reset or adjust the limit in `notification-helper.js`.

## Testing the Complete Flow

Use the debug script:

```bash
chmod +x test-cron-webhook-debug.sh
./test-cron-webhook-debug.sh
```

This will:
1. ✅ Verify agent webhook configuration
2. ✅ Send test notification via agent API
3. ✅ Test direct delivery to frontend (bypass agent)
4. ✅ Simulate OpenClaw cron webhook payload

All tests should pass for the system to work correctly.

## Expected Log Flow

When a cron job completes, you should see this log sequence:

```
# On OpenClaw Gateway
[gateway] cron job finished: My Cron Job [success]
[gateway] sending webhook to: https://polymarket-trader.../api/openclaw-cron-webhook

# On Agent
[cron-webhook] Received payload: {type: "cron.finished", job: {...}, run: {...}}
[cron-webhook] Forwarding notification: My Cron Job [success]
[notification] sending cron: My Cron Job
[notification] webhook URL: https://laughing-pancake...
[notification] webhook success: 200
[cron-webhook] ✅ Successfully forwarded cron job: My Cron Job [success]

# On Frontend
[webhook] received notification: cron "My Cron Job"
[db] saved notification for user: ...
[socket] emitted notification to user: ...
```

## Still Not Working?

1. **Check all environment variables** are set correctly on Railway
2. **Verify the frontend URL** is accessible from Railway
3. **Check Railway logs** for any error messages with the enhanced logging
4. **Test with direct curl** to the frontend webhook (we know this works)
5. **Compare the payloads** - the agent should send the same format as the working curl
6. **Check firewall/network rules** between Railway and GitHub Codespaces

## Need Help?

Provide these details:
- Output from `./test-cron-webhook-debug.sh`
- Railway logs showing the cron webhook flow
- Frontend logs showing webhook receipt
- cURL output from status check endpoint
