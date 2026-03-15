# 🚀 Complete Fix Guide for Your Deployment

## Your Configuration

- **Agent URL**: `https://polymarket-trader-production-378a.up.railway.app`
- **Wrapper API Key**: `a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087`
- **Railway Project**: https://railway.com/project/9a742cdc-6daf-4160-8b82-0fe15c1adabc

---

## 📝 Step-by-Step Fix

### Step 1: Set Environment Variables on Railway

1. **Go to Railway**: https://railway.com/project/9a742cdc-6daf-4160-8b82-0fe15c1adabc

2. **Find your agent service** (should be named something like "polymarket-trader-production-378a" or similar)

3. **Click on the Variables tab**

4. **Add these TWO environment variables**:

   **First variable:**
   ```
   Name: LAUNCHER_WEBHOOK_URL
   Value: https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/6df09d45-d8d8-42ba-a00a-74283c383488
   ```

   **Second variable:**
   ```
   Name: LAUNCHER_AGENT_TOKEN
   Value: 6a1e32d38ed3d5b3093a101739932aa08cf0561135c5baba5775743c0474e04e
   ```

5. **Save** - Railway will automatically redeploy your service

6. **Wait** for the deployment to complete (usually 1-2 minutes)

---

### Step 2: Run the Auto-Fix Script

Once the service has redeployed, run this script to verify and fix everything:

```bash
chmod +x fix-polymarket-trader-378a.sh
./fix-polymarket-trader-378a.sh
```

This script will:
- ✅ Check if your agent is reachable
- ✅ Verify environment variables are set correctly
- ✅ Send a test notification to your frontend
- ✅ Test the cron webhook endpoint
- ✅ Automatically fix all your cron jobs to enable webhooks

---

## 🔧 Manual Commands (if script doesn't work)

### Check if notifications are configured:

```bash
curl -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://polymarket-trader-production-378a.up.railway.app/api/notifications/status
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

If `configured: false`, go back to Step 1 above.

---

### Send a test notification:

```bash
curl -X POST \
  -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "info",
    "title": "Test Notification",
    "message": "This is a test!"
  }' \
  https://polymarket-trader-production-378a.up.railway.app/api/notifications/test
```

Check your frontend - you should see the notification appear!

---

### Auto-fix all cron jobs:

```bash
curl -X POST \
  -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://polymarket-trader-production-378a.up.railway.app/api/cron/audit-webhooks
```

This will automatically configure all your cron jobs to send webhooks when they complete.

---

### Test cron webhook manually:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron.finished",
    "job": {
      "id": "test-123",
      "name": "Manual Test Cron",
      "schedule": "*/5 * * * *"
    },
    "run": {
      "status": "completed",
      "summary": "This is a manual test of cron webhooks",
      "startedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "endedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "duration": 1.5
    }
  }' \
  https://polymarket-trader-production-378a.up.railway.app/api/openclaw-cron-webhook
```

This simulates what happens when a real cron job completes. Check your frontend - you should see a notification!

---

### List all cron jobs:

```bash
curl -X POST \
  -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  -H "Content-Type: application/json" \
  -d '{"message": "run this command: openclaw cron list --json"}' \
  https://polymarket-trader-production-378a.up.railway.app/api/chat
```

---

## ✅ Verification Checklist

- [ ] Set `LAUNCHER_WEBHOOK_URL` on Railway
- [ ] Set `LAUNCHER_AGENT_TOKEN` on Railway
- [ ] Service redeployed successfully
- [ ] `/api/notifications/status` shows `"configured": true`
- [ ] Test notification appears in frontend
- [ ] Ran `/api/cron/audit-webhooks` and it completed
- [ ] Manual cron webhook test appears in frontend
- [ ] Actual cron job notifications now appear in frontend

Once all items are checked, you're done! 🎉

---

## 🆘 Troubleshooting

### "configured: false" after setting variables

- Double-check the variable names are EXACTLY:
  - `LAUNCHER_WEBHOOK_URL` (not launcher_webhook_url)
  - `LAUNCHER_AGENT_TOKEN` (not launcher_agent_token)
- Make sure there are no extra spaces in the values
- Wait a full minute for the deployment to complete
- Try triggering a manual redeploy in Railway

### Test notification doesn't appear

- Check the frontend webhook URL is accessible
- Check Railway logs for error messages (look for `[notification]` entries)
- Try the manual cron webhook test command
- Verify the `LAUNCHER_AGENT_TOKEN` matches what the frontend expects

### Cron jobs still don't send notifications

- Run the audit command again: `/api/cron/audit-webhooks`
- Check Railway logs when a cron job runs
- List cron jobs and verify they have webhook delivery configured
- Try removing and recreating a cron job through the chat interface

### "Unauthorized" errors

- Verify the wrapper API key: `a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087`
- Make sure you're hitting the correct Railway URL
- Check that the service is running and healthy

---

## 📞 Need Help?

If you're still having issues:

1. Check Railway deployment logs for errors
2. Run the diagnostic script: `./fix-polymarket-trader-378a.sh`
3. Copy the output and report what went wrong

The most common issue is forgetting to set the environment variables or setting them on the wrong service (the launcher instead of the agent).
