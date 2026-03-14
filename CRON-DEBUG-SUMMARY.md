# Cron Notification Debugging - Changes Summary

## What Was Done

### 1. Enhanced Logging in `notification-helper.js`
- Added verbose logging to show webhook URL being called
- Log the exact payload being sent
- Show response status and body on success
- Show detailed error information on failure

### 2. Enhanced Logging in `server.js` (cron webhook endpoint)
- Log the complete payload received from OpenClaw
- Show notification data being forwarded
- Track whether notification was successfully sent
- Return `notificationSent` status in response

### 3. Created Debug Tools

#### `test-cron-webhook-debug.sh`
Comprehensive test script that:
- Checks if webhook is configured on agent
- Sends test notification via agent API
- Tests direct delivery to frontend (bypass agent)
- Simulates OpenClaw cron webhook payload

#### `CRON-NOTIFICATION-TROUBLESHOOTING.md`
Complete troubleshooting guide covering:
- Step-by-step diagnosis
- Common issues and solutions
- Expected log flow
- Testing commands

## Next Steps to Diagnose

### Step 1: Verify Configuration ✅
```bash
curl -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  https://polymarket-trader-production-7c0d.up.railway.app/api/notifications/status
```

**Result:** Webhook is configured ✅

### Step 2: Send Test Notification
```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"type": "cron", "title": "Test Notification", "message": "Testing delivery"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/notifications/test
```

This will:
- Send a test notification through the agent
- Show in Railway logs if webhook succeeds/fails
- Appear in frontend UI if working

### Step 3: Check Railway Logs

After sending the test notification, check Railway logs for:

**Success pattern:**
```
[notification] sending cron: Test Notification
[notification] webhook URL: https://laughing-pancake...
[notification] webhook success: 200 {"ok":true}
```

**Failure patterns:**
```
[notification] webhook failed: 404 Not Found
[notification] webhook timeout after 5000 ms
[notification] webhook error: ECONNREFUSED
```

### Step 4: Test Cron Webhook Endpoint

Simulate what OpenClaw sends when a cron job completes:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron.finished",
    "job": {
      "id": "test-job-123",
      "name": "Debug Test Cron",
      "schedule": {"kind": "cron"}
    },
    "run": {
      "status": "success",
      "summary": "Completed successfully",
      "startedAt": "2026-03-14T10:00:00Z",
      "endedAt": "2026-03-14T10:00:05Z",
      "duration": 5000
    }
  }' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook
```

Expected response:
```json
{
  "ok": true,
  "received": true,
  "notificationSent": true
}
```

If `notificationSent: false`, the agent received the cron event but failed to forward to frontend.

### Step 5: Verify Cron Jobs Are Configured for Webhooks

Check your OpenClaw cron jobs:

```bash
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"message": "list all cron jobs with their delivery configuration"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/chat
```

Make sure they have:
```json
{
  "delivery": {
    "mode": "webhook",
    "to": "https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook"
  }
}
```

## Most Likely Issues

### Issue #1: Cron Jobs Not Configured for Webhook Delivery
**Most common issue.** OpenClaw cron jobs need to explicitly send to webhook.

**Solution:** When creating cron jobs, add:
```bash
--webhook \
--webhook-url "https://polymarket-trader-production-7c0d.up.railway.app/api/openclaw-cron-webhook"
```

### Issue #2: GitHub Codespaces URL Changed
Codespace URLs are temporary. If your codespace restarted, the URL might have changed.

**Solution:** Update `LAUNCHER_WEBHOOK_URL` with the new codespace URL.

### Issue #3: Network/Firewall Between Railway and Codespaces
Railway might not be able to reach GitHub Codespaces.

**Test:** Use the direct curl test from Step 4 above. If you see timeout errors in Railway logs, this is the issue.

### Issue #4: Frontend Not Saving/Displaying
The webhook reaches the frontend but doesn't save or show.

**Test:** Check frontend logs when you run the direct test curl (the one that you said works).

## Deploy Changes

To deploy the enhanced logging:

1. **Commit and push changes:**
   ```bash
   git add src/notification-helper.js src/server.js
   git commit -m "Add enhanced logging for cron notifications"
   git push
   ```

2. **Railway will auto-deploy**

3. **Test again** with the commands above

4. **Check Railway logs** for the new verbose output

## Quick Verification Commands

```bash
# 1. Check status
curl -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  https://polymarket-trader-production-7c0d.up.railway.app/api/notifications/status

# 2. Send test
curl -X POST \
  -H "Authorization: Bearer c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9" \
  -H "Content-Type: application/json" \
  -d '{"type":"cron","title":"Quick Test","message":"Testing"}' \
  https://polymarket-trader-production-7c0d.up.railway.app/api/notifications/test

# 3. Check if notification appeared in frontend

# 4. If not, check Railway logs for error details
```

## Summary

The code in `notification-helper.js` is correct and matches the format that works in your manual test. The issue is likely one of:

1. ✅ **Webhook is configured** (verified)
2. ❓ **Can Railway reach GitHub Codespaces?** (needs testing)
3. ❓ **Are cron jobs configured to send webhooks?** (needs verification)
4. ❓ **Is there a network timeout or error?** (enhanced logs will show)

Run the test commands above and check Railway logs to pinpoint the exact issue!
