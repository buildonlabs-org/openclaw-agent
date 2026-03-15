# Cron Delivery Mode Refactor

## Summary

Refactored the cron job notification system to have agents POST full results themselves instead of relying on OpenClaw's `delivery.mode = "webhook"` which only sends summaries.

## The Problem

OpenClaw's built-in webhook delivery (`delivery.mode = "webhook"`) only sends summary snippets like:
```
✅ Completed successfully
```

It doesn't send the full agent response with actual data. This meant users would get notifications but not see the actual results (e.g., price data, market odds, etc.).

## The Solution

**Have agents POST full results themselves:**

1. Set `delivery.mode = "none"`
2. Inject instructions into the agent's message to POST full results
3. Agent completes work and POSTs to: `${AGENT_URL}/api/openclaw-cron-webhook`
4. Backend receives full content and forwards to launcher UI

## Changes Made

### 1. Message Injection ([server.js](src/server.js) ~line 3190)

**Before:**
```javascript
finalMessage = `${message}

When creating this cron job, configure it with webhook delivery mode and set the webhook URL to: ${webhookUrl}

This ensures completion notifications are sent to the launcher UI.`;
```

**After:**
```javascript
finalMessage = `${message}

CRITICAL: After completing your work, POST the FULL result to this webhook URL: ${webhookUrl}

Use curl, fetch, or any HTTP tool you have available. The payload should be JSON:
{
  "jobName": "your job name",
  "status": "success",
  "content": "your complete response here",
  "timestamp": "ISO timestamp"
}

Set the cron job's delivery mode to "none" since you're posting the result yourself. This ensures the launcher UI receives your complete response, not just a summary.`;
```

### 2. Verification Function ([server.js](src/server.js) ~line 3328)

**Before:**
- Checked if jobs have `delivery.mode = "webhook"`
- Updated jobs with `--webhook --webhook-url` flags

**After:**
- Checks if jobs use old `delivery.mode = "webhook"` (deprecated)
- Updates them to `delivery.mode = "none"`
- Agent handles POSTing results themselves

### 3. Periodic Audit ([server.js](src/server.js) ~line 3840)

**Before:**
- Ensured all jobs have webhook delivery configured
- Used `--webhook --webhook-url` to fix jobs

**After:**
- Ensures all jobs use `delivery.mode = "none"`
- Agents POST results themselves (no OpenClaw webhook delivery)

### 4. Webhook Endpoint ([server.js](src/server.js) ~line 765)

**Added new format handler:**
```javascript
// Format 0: Agent-posted full content (NEW - primary format)
if (payload.content && (payload.jobName || payload.status)) {
  job = {
    id: payload.jobId || 'agent-posted',
    name: payload.jobName || 'Cron Job',
    schedule: payload.schedule
  };
  run = {
    status: payload.status || 'completed',
    output: payload.content, // Full content from agent
    // ...
  };
  eventType = 'agent-posted';
  console.log('[cron-webhook] ✅ Received agent-posted full content');
}
```

Old formats (cron.finished, etc.) still supported for backward compatibility but logged as deprecated.

### 5. Documentation ([.agent.md](.agent.md))

Updated agent instructions to:
- Use `--delivery none` instead of `--webhook --webhook-url`
- Include instructions for agent to POST results
- Explain why this approach is better (full content vs summaries)

## Payload Format

Agents should POST to `/api/openclaw-cron-webhook` with:

```json
{
  "jobName": "Your Job Name",
  "status": "success",
  "content": "Your complete response text with all data",
  "timestamp": "2026-03-15T10:30:00Z",
  "jobId": "optional-job-id",
  "duration": 1250
}
```

## Migration Path

### For New Cron Jobs

Automatically handled by message injection. When users request cron jobs, the system:
1. Detects cron patterns in messages
2. Injects instructions to POST results
3. Creates job with `delivery.mode = "none"`

### For Existing Cron Jobs

Two automated mechanisms:
1. **Post-chat verification** - After any chat that might create cron jobs
2. **Periodic audit** - Every 5 minutes, checks all jobs

Both will:
- Find jobs using old `delivery.mode = "webhook"`
- Update them to `delivery.mode = "none"`
- Log the change

## Backward Compatibility

The webhook endpoint still accepts old formats:
- `cron.finished` events
- `job/run` structures  
- Flat structures
- Gateway formats

They're handled but logged as deprecated/only having summaries.

## Testing

Run the test script:
```bash
./test-agent-posted-webhook.sh http://localhost:3000
```

Tests:
1. ✅ Agent-posted full content (new format)
2. ⚠️ Old cron.finished event (backward compatibility)
3. ✅ Event type detection

## Benefits

| Old Approach | New Approach |
|-------------|--------------|
| ❌ Only summaries | ✅ Full responses |
| ❌ "Completed successfully" | ✅ Complete data/results |
| ❌ OpenClaw limitations | ✅ Full control |
| ⚠️ Workarounds with CLI | ✅ Direct content |

## Flow Comparison

### Old Flow
```
Cron runs → OpenClaw delivery.mode=webhook → 
Summary only → Backend → Incomplete notification → Frontend
```

### New Flow
```
Cron runs → Agent completes work → Agent POSTs full result → 
Backend receives full content → Complete notification → Frontend
```

## Next Steps

1. Test with real cron jobs
2. Monitor logs for format detection
3. Verify frontend receives full content
4. Remove old format handlers after migration (optional)

## Notes

- The routing was already correct: OpenClaw → Backend → Frontend
- The problem was OpenClaw only sent summaries
- Now agents bypass OpenClaw's delivery system entirely
- Agents POST directly to backend with full results
