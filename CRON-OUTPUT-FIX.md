# Cron Job Output Fix

## Problem

Cron job notifications were only showing a one-line summary like:
```
✅ Here are the current 2028 presidential election odds from Polymarket.
```

Instead of showing the actual data (the odds themselves).

## Root Cause

**OpenClaw's webhook delivery mode only sends a summary, not the full agent response.**

From OpenClaw docs:
> "When delivery.mode = "webhook", cron posts the finished event payload to delivery.to when the finished event includes a **summary**."

The webhook payload structure is:
```json
{
  "type": "cron.finished",
  "job": {...},
  "run": {
    "runId": "run-abc-123",
    "status": "success",
    "summary": "Completed successfully: ..."  // ← Only a summary, not full output
  }
}
```

This is a design limitation in OpenClaw's cron system - webhook delivery does not include the full agent response, only a summary.

## Solutions

Since OpenClaw only sends summaries via webhook, you need to retrieve the full output differently. Here are the working solutions:

### Solution 1: Query Run Details Using runId (Recommended)

OpenClaw includes a `runId` in the webhook payload. Use this to fetch the full run details:

```javascript
// In the webhook handler, after receiving the payload
const runId = run?.runId;
if (runId) {
  // Query OpenClaw for full run details
  const result = await runCmd(OPENCLAW_CLI, ["cron", "run", "get", runId, "--json"]);
  if (result.code === 0) {
    const fullRunData = JSON.parse(result.output);
    // fullRunData should contain the complete agent response
    const fullOutput = fullRunData.output || fullRunData.result || fullRunData.response;
    if (fullOutput) {
      content = fullOutput; // Use full output instead of summary
    }
  }
}
```

### Solution 2: Use Custom Session + Query Messages

Instead of isolated sessions, run the cron in a custom persistent session, then query that session's messages:

**Create cron with custom session:**
```bash
openclaw cron add \
  --name "Polymarket 2028 Odds" \
  --cron "* * * * *" \
  --session "session:polymarket-odds-feed" \
  --message "Get the current 2028 presidential election odds from Polymarket" \
  --webhook \
  --webhook-url "https://your-agent/api/openclaw-cron-webhook"
```

**In webhook handler, query the session:**
```javascript
// sessionTarget from webhook: "session:polymarket-odds-feed"
const sessionKey = job?.sessionTarget?.replace('session:', '');
if (sessionKey) {
  // Query session messages
  const messages = await getSessionMessages(sessionKey);
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.content) {
    content = lastMessage.content; // Full agent response
  }
}
```

### Solution 3: Use Announce Delivery Instead (Frontend Gets Full Data)

Switch from webhook delivery to announce delivery. The agent will send the full response directly to the target channel:

```bash
openclaw cron add \
  --name "Polymarket 2028 Odds" \
  --cron "* * * * *" \
  --session isolated \
  --message "Get the current 2028 presidential election odds from Polymarket and send them" \
  --announce \
  --channel whatsapp \
  --to "+15551234567"
```

With announce delivery:
- The full agent response goes directly to the channel (WhatsApp, Telegram, etc.)
- No webhook is involved
- A short summary is posted to the main session

### Solution 4: Have Agent Send Notification Directly

Have the cron job's message instruct the agent to send a notification with the full data:

```bash
openclaw cron add \
  --name "Polymarket 2028 Odds" \
  --cron "* * * * *" \
  --session isolated \
  --message "Get the current 2028 presidential election odds from Polymarket, then POST the full results to https://your-agent/api/cron-data-webhook with a JSON body containing the odds data"
```

This way the agent itself will make the HTTP request with the full data during its run.

## Recommended Implementation: Query Run Details

I'll implement Solution 1 (query run details using runId) as it's the cleanest approach that works with the existing webhook setup.

### Changes Needed

Update the webhook handler to fetch full run details when a runId is available:

```javascript
// After parsing the webhook payload
const runId = run?.runId;
let content = run?.summary || run?.error || 'Completed';

// Try to fetch full run details if runId is available
if (runId) {
  console.log(`[cron-webhook] Fetching full run details for runId: ${runId}`);
  try {
    const result = await runCmd(OPENCLAW_CLI, ["cron", "run", "get", runId, "--json"]);
    if (result.code === 0) {
      const fullRunData = JSON.parse(result.output);
      console.log('[cron-webhook] Full run data keys:', Object.keys(fullRunData));
      
      // Extract full output from run data
      const fullOutput = fullRunData.output || 
                        fullRunData.result || 
                        fullRunData.response || 
                        fullRunData.text ||
                        fullRunData.content;
      
      if (fullOutput && fullOutput.length > content.length) {
        content = fullOutput;
        console.log(`[cron-webhook] Using full output (${fullOutput.length} chars)`);
      }
    }
  } catch (err) {
    console.warn('[cron-webhook] Failed to fetch full run details:', err.message);
    // Fall back to summary
  }
}
```

This approach:
- ✅ Works with existing cron job setup (no need to recreate jobs)
- ✅ Backward compatible (falls back to summary if query fails)
- ✅ Gets the actual agent response, not just a summary
- ✅ Minimal changes to existing code

### Alternative: Use Custom Session (Better for Long-term)

If the OpenClaw CLI doesn't support `cron run get`, use Solution 2 (custom session):

**Recreate the cron job with a persistent session:**
```bash
# Delete old job
openclaw cron remove <old-job-id>

# Create new job with custom session
openclaw cron add \
  --name "Polymarket 2028 Presidential Election Odds" \
  --cron "* * * * *" \
  --session "session:polymarket-2028-feed" \
  --message "Get the current 2028 presidential election odds from Polymarket" \
  --webhook \
  --webhook-url "https://polymarket-trader-production-378a.up.railway.app/api/openclaw-cron-webhook"
```

**Then update webhook handler to query session messages:**
```javascript
const sessionKey = job?.sessionTarget?.replace(/^session:/, '');
if (sessionKey && sessionKey !== 'isolated') {
  // Query the session for full messages
  // (Implementation depends on OpenClaw's session API)
}
```

## Implementation Complete

✅ **Updated webhook handler** to query full run details when only a summary is available

### What Changed

Modified [src/server.js](src/server.js) webhook handler to:

1. **Check webhook payload** for `run.output`, `run.result`, `run.response`, `run.text` first
2. **If only summary available**, query OpenClaw for full run details:
   ```bash
   openclaw cron runs --id <jobId> --limit 1 --json
   ```
3. **Extract full output** from the latest run data
4. **Fall back to summary** if query fails or returns no output
5. **Log everything** for debugging:
   - Content type (full output vs summary)
   - Content length
   - Run data keys

### Next Steps

1. **Commit and deploy:**
   ```bash
   git add src/server.js CRON-OUTPUT-FIX.md
   git commit -m "Query full cron run output instead of using webhook summary"
   git push
   ```

2. **Wait for next cron run** (every minute for the Polymarket odds job)

3. **Check Railway logs** for:
   ```
   [cron-webhook] Attempting to fetch full run details for runId: ...
   [cron-webhook] Latest run data keys: [...]
   [cron-webhook] ✅ Retrieved full output (1234 chars)
   [cron-webhook] Content type: full output
   ```

4. **Verify notification** shows the full odds data, not just the summary

### If Still Not Working

If the logs show the OpenClaw CLI `cron runs` command doesn't include the full output either, you'll need to use **Solution 2** (custom session):

1. Delete the current cron job
2. Recreate it with a custom session instead of isolated:
   ```bash
   openclaw cron add \
     --name "Polymarket 2028 Presidential Election Odds" \
     --cron "* * * * *" \
     --session "session:polymarket-2028-feed" \
     --message "Get the current 2028 presidential election odds from Polymarket" \
     --webhook \
     --webhook-url "https://polymarket-trader-production-378a.up.railway.app/api/openclaw-cron-webhook"
   ```
3. Update the webhook handler to query that session's messages

Or use **Solution 3** (announce delivery) to bypass webhooks entirely and have the agent send the full response directly to your channel.
