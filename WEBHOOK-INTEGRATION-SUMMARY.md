# 🎯 Webhook Integration - Complete Summary

This document provides a complete overview of the webhook notification system integration for the OpenClaw Agent.

## 📋 What Was Done

### ✅ Files Created

1. **`src/notification-helper.js`** - Core notification module
   - Functions: `notifyCronJob()`, `notifyTaskComplete()`, `notifyError()`, `notifyInfo()`
   - Rate limiting (100/hour)
   - Automatic error handling
   - Configurable via environment variables

2. **Documentation Files**:
   - `WEBHOOK-INTEGRATION.md` - Complete integration guide
   - `CRON-TO-FRONTEND-GUIDE.md` - Specific guide for cron jobs
   - `WEBHOOK-FLOW-DIAGRAM.md` - Visual architecture diagrams
   - `WEBHOOK-QUICKSTART.md` - Quick reference card
   - `test-webhook-notifications.sh` - Test script

### ✅ Files Modified

1. **`src/server.js`** - Integrated notifications at key points:
   - Server startup notification
   - Gateway start/stop/crash notifications
   - Device auto-approval notifications (cron job every 5s)
   - Skills installation notifications
   - Error notifications throughout
   - New API endpoints: `/api/notifications/status` and `/api/notifications/test`

2. **`README.md`** - Added webhook notifications feature section

## 🔌 How It Works

### Configuration (Automatic)

When the launcher deploys your agent, it automatically sets:

```bash
LAUNCHER_WEBHOOK_URL=https://launcher.com/api/notifications/webhook/{serviceId}
LAUNCHER_AGENT_TOKEN=<unique-token-for-this-agent>
```

**No manual configuration needed!**

### Notification Flow

```
Cron Job Runs → notification-helper.js → Launcher Webhook → Database → Frontend UI
```

1. **Agent sends notification**:
   ```javascript
   await notifyCronJob('Task Name', 'Completed successfully', { records: 100 });
   ```

2. **Helper sends HTTP POST** to launcher with token authentication

3. **Launcher validates, stores** in database

4. **Frontend displays** as badge and in notification panel

### Current Notifications

The agent automatically sends notifications for:

| Event | Type | When |
|-------|------|------|
| Server startup | `info` | Agent starts |
| Gateway started | `info` | Gateway becomes ready |
| Gateway exit | `error` | Gateway crashes |
| Device approved | `cron` | Device auto-approval succeeds |
| Device approval failed | `error` | Device auto-approval fails |
| Skills installed | `info` | Skills copied from cache |
| Skill install failed | `error` | Skill copy fails |
| Skill cache error | `error` | Cache operation fails |

## 🧪 Testing

### Quick Test

```bash
# Test all notification types
./test-webhook-notifications.sh

# Check if configured
curl http://localhost:8080/api/notifications/status \
  -H "Authorization: Bearer $WRAPPER_API_KEY"

# Send manual test
curl -X POST http://localhost:8080/api/notifications/test \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"info","title":"Test","message":"Hello"}'
```

### Expected Results

1. **Status endpoint** returns:
   ```json
   {
     "ok": true,
     "configured": true,
     "rateLimit": {
       "count": 5,
       "remaining": 95
     }
   }
   ```

2. **Notifications appear in launcher**:
   - Badge on agent card: "3"
   - Notification panel shows all notifications
   - Filter by type (cron, task, error, info)
   - Auto-refresh every 30 seconds

## 📦 What's Included

### Notification Types

| Type | Icon | Use Case | Example |
|------|------|----------|---------|
| `cron` | ⏰ | Scheduled tasks | "Daily backup completed" |
| `task` | ✓ | User tasks | "File processing done" |
| `error` | ⚠️ | Errors | "API connection failed" |
| `info` | ℹ️ | Updates | "Agent restarted" |

### API Endpoints

```bash
# Check notification status
GET /api/notifications/status

# Send test notification
POST /api/notifications/test
{
  "type": "info|cron|task|error",
  "title": "Title",
  "message": "Message"
}
```

### Rate Limits

- **100 notifications per hour** per agent
- Title: max 200 characters
- Message: max 1000 characters
- Timeout: 5 seconds per webhook call

## 🎨 Frontend UI

Users see:

```
┌────────────────────────────┐
│  OpenClaw Agent    🔔 [3]  │  ← Badge shows unread count
│  Status: Running           │
│  Memory: 512MB             │
└────────────────────────────┘

Click badge ▼

┌────────────────────────────────────┐
│ 🔔 Notifications          [x]      │
├────────────────────────────────────┤
│ Filter: [All] Cron Task Error Info │
├────────────────────────────────────┤
│ ⏰ Device Auto-Approved            │
│    Device request approved         │
│    5 minutes ago            [Read] │
├────────────────────────────────────┤
│ ⚠️ Gateway Exited                  │
│    Process exited with code 1      │
│    1 hour ago               [Read] │
└────────────────────────────────────┘
```

## 🚀 Adding New Notifications

### Option 1: Direct Call

```javascript
import { notifyCronJob, notifyError, notifyInfo } from './notification-helper.js';

// In your code
await notifyCronJob('Backup Complete', 'Backed up 1,234 files', { files: 1234 });
await notifyError('API Failed', 'GitHub rate limited', { api: 'github' });
await notifyInfo('Config Updated', 'New settings applied', { setting: 'model' });
```

### Option 2: Wrap Function (Automatic)

```javascript
import { withNotification } from './notification-helper.js';

const backupData = withNotification('Daily Backup', async () => {
  // Your code here
  return { filesBackedUp: 100 };
});

await backupData(); // Automatically sends success/error notification
```

### Example: New Cron Job

```javascript
setInterval(async () => {
  try {
    const result = await performHealthCheck();
    
    // Only notify if there's an issue
    if (result.errors > 0) {
      await notifyError(
        'Health Check Failed',
        `Found ${result.errors} issues`,
        { errors: result.errors, details: result.details }
      );
    }
  } catch (error) {
    await notifyError('Health Check Error', error.message);
  }
}, 5 * 60 * 1000); // Every 5 minutes
```

## 📊 Monitoring

### Server Logs

```bash
# Watch notification activity
tail -f /tmp/openclaw/*.log | grep notification

# Expected output:
[notification] webhook configured and ready
[notification] sent: Device Auto-Approved
[notification] rate limit exceeded, skipping notification
[notification] webhook failed: 401 Unauthorized
```

### Status Endpoint

```bash
curl http://localhost:8080/api/notifications/status \
  -H "Authorization: Bearer $WRAPPER_API_KEY" | jq
```

Returns:
```json
{
  "ok": true,
  "configured": true,
  "webhook": {
    "url": "[configured]",
    "tokenSet": true
  },
  "rateLimit": {
    "count": 15,
    "limit": 100,
    "remaining": 85,
    "windowRemainingMs": 3245000
  }
}
```

## 🔍 Troubleshooting

### Problem: Notifications not appearing

**Solution**:
```bash
# 1. Check if configured
curl http://localhost:8080/api/notifications/status -H "Authorization: Bearer $WRAPPER_API_KEY"

# 2. Verify environment variables
echo $LAUNCHER_WEBHOOK_URL
echo $LAUNCHER_AGENT_TOKEN

# 3. Send test notification
curl -X POST http://localhost:8080/api/notifications/test \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"info","title":"Test","message":"Testing"}'

# 4. Check server logs
tail -f /tmp/openclaw/*.log | grep notification
```

### Problem: Rate limit exceeded

**Solution**: Reduce notification frequency
```javascript
// BAD - sends too many
setInterval(() => notifyCronJob('Check', 'OK'), 1000); // Every second = 3,600/hour!

// GOOD - smart throttling
let lastNotify = 0;
setInterval(() => {
  if (Date.now() - lastNotify > 60000) { // Max once per minute
    notifyCronJob('Check', 'OK');
    lastNotify = Date.now();
  }
}, 1000);
```

### Problem: Webhook timeout

**Solution**: Check network connectivity
```bash
# Test webhook endpoint directly
curl -X POST $LAUNCHER_WEBHOOK_URL \
  -H "X-Agent-Token: $LAUNCHER_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"info","title":"Direct Test","message":"Testing webhook"}'
```

## 📚 Documentation Reference

| Document | Purpose |
|----------|---------|
| [WEBHOOK-INTEGRATION.md](./WEBHOOK-INTEGRATION.md) | Complete integration guide |
| [CRON-TO-FRONTEND-GUIDE.md](./CRON-TO-FRONTEND-GUIDE.md) | Cron job → frontend guide |
| [WEBHOOK-FLOW-DIAGRAM.md](./WEBHOOK-FLOW-DIAGRAM.md) | Architecture diagrams |
| [WEBHOOK-QUICKSTART.md](./WEBHOOK-QUICKSTART.md) | Quick reference card |
| [test-webhook-notifications.sh](./test-webhook-notifications.sh) | Test script |

## ✨ Benefits for Users

1. **Real-time visibility**: See what's happening inside agents
2. **Error awareness**: Get notified immediately when something fails
3. **Task tracking**: Know when cron jobs complete
4. **Better debugging**: Historical log of all events
5. **No SSH needed**: Everything visible in launcher UI

## 🎯 Next Steps

### Immediate

✅ **Done** - Integration complete and working
✅ **Done** - Documentation created
✅ **Done** - Test script ready

### Optional Enhancements

You can add notifications for:
- Model selection changes
- Wallet balance updates
- Skill installations/removals
- Configuration changes
- Long-running task progress
- Health check failures
- API usage metrics

### Adding More Notifications

Simply import and call:
```javascript
import { notifyCronJob, notifyInfo, notifyError } from './notification-helper.js';

// Your code + notification
await notifyInfo('Feature Enabled', 'New feature activated', { feature: 'X' });
```

## 💡 Key Takeaways

1. **Zero configuration** - Environment variables set automatically by launcher
2. **Non-breaking** - If webhook fails, agent continues normally
3. **Rate-limited** - 100/hour prevents spam
4. **Type-safe** - Four notification types for different contexts
5. **Frontend-ready** - Notifications appear immediately in launcher UI
6. **Well-documented** - Comprehensive guides and examples
7. **Tested** - Test script validates all functionality

---

## 🎉 Success!

The webhook notification system is **fully integrated and ready to use**. 

When the launcher deploys your agent, notifications will automatically flow from cron jobs and system events to the frontend UI, giving users real-time visibility into agent operations.

**No additional action required!** 🚀
