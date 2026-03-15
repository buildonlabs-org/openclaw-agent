# 🎯 Quick Fix: Set Environment Variables on the RIGHT Railway Service

## Important: You Have TWO Services

Looking at your setup:

1. **Launcher/Frontend Service** (Service ID: `6df09d45-d8d8-42ba-a00a-74283c383488`)
   - This is at: https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev
   - You showed me this service's variables page
   - ❌ This is NOT where you need to set the variables

2. **Agent Service** (Unknown URL - this is what we need to find!)
   - This runs the OpenClaw agent
   - This is the service that runs cron jobs
   - ✅ This is WHERE you need to set the variables

## Step 1: Find Your Agent Service

In your Railway dashboard (https://railway.com/project/9a742cdc-6daf-4160-8b82-0fe15c1adabc):

1. Look at the list of services in this project
2. You should see **at least 2 services**:
   - One is the launcher/frontend (the one you showed me)
   - One is the OpenClaw agent (this is what we need)

The agent service will likely be named something like:
- `openclaw-agent`
- `agent`
- `polymarket-trader`
- Or have a different service name

## Step 2: Identify the Agent Service

To confirm which one is the agent, look for:

1. **Environment variables** it might have like:
   - `OPENCLAW_GATEWAY_TOKEN`
   - `WRAPPER_API_KEY` = `a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087`
   - `OPENCLAW_CONFIG_PATH`

2. **Deployment logs** showing:
   - OpenClaw gateway starting
   - Cron job executions
   - Chat API endpoints

3. **Public domain** that looks like:
   - `something-production-XXXX.up.railway.app`

## Step 3: Test to Confirm (Optional)

If you have the agent's public URL, test it:

```bash
# Replace YOUR-AGENT-URL with the Railway public domain
curl -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://YOUR-AGENT-URL/api/notifications/status
```

If this returns a JSON response, you found the right service!

## Step 4: Set the Environment Variables

Once you've identified the **agent service** (NOT the launcher):

1. Click on that service in Railway
2. Go to the **Variables** tab
3. Add these two variables:

```
LAUNCHER_WEBHOOK_URL=https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/6df09d45-d8d8-42ba-a00a-74283c383488
```

```
LAUNCHER_AGENT_TOKEN=6a1e32d38ed3d5b3093a101739932aa08cf0561135c5baba5775743c0474e04e
```

4. Save (Railway will auto-redeploy)

## Step 5: Verify and Fix Cron Jobs

After redeploy, verify notifications are configured:

```bash
curl -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://YOUR-AGENT-URL/api/notifications/status
```

Should return: `"configured": true`

Then auto-fix all cron jobs:

```bash
curl -X POST \
  -H "Authorization: Bearer a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087" \
  https://YOUR-AGENT-URL/api/cron/audit-webhooks
```

Done! 🎉

---

## 🆘 Can't Find the Agent Service?

If you only see one service in Railway, or can't find the agent:

1. **Check if you're looking at the right Railway project**
   - The link you shared is for project `9a742cdc-6daf-4160-8b82-0fe15c1adabc`
   - Make sure there's not another project with the agent

2. **Look for other Railway projects** in your account
   - The agent might be in a different Railway project

3. **Check the service you showed me more carefully**
   - Click on Settings → look at the container logs
   - If you see OpenClaw gateway logs, then THIS is the agent service
   - Set the variables in this service's Variables tab

4. **Use the wrapper API key to find it**
   - Run the script: `./find-agent-deployment.sh`
   - Or manually try Railway URLs with your API key

---

## 📋 Quick Checklist

- [ ] Found the agent service in Railway (not the launcher)
- [ ] Added `LAUNCHER_WEBHOOK_URL` environment variable
- [ ] Added `LAUNCHER_AGENT_TOKEN` environment variable  
- [ ] Service redeployed successfully
- [ ] Verified with `/api/notifications/status` shows `configured: true`
- [ ] Ran `/api/cron/audit-webhooks` to fix cron jobs
- [ ] Tested notification delivery

If all boxes are checked, notifications should work! ✅
