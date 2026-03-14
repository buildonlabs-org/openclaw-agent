# 🔄 How Cron Jobs Send Notifications to Frontend

## Overview

This document explains how scheduled tasks (cron jobs) in the OpenClaw Agent automatically send notifications to the launcher frontend, allowing users to see real-time updates about background tasks.

## Architecture Flow

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  OpenClaw Agent │      │ Launcher Backend │      │ Launcher UI     │
│  (Your Server)  │─────>│   (Webhook API)  │─────>│  (Frontend)     │
└─────────────────┘      └──────────────────┘      └─────────────────┘
   Cron Job runs         Receives notification      Shows badge/panel
```

## Current Cron Jobs with Notifications

### 1. Device Auto-Approval Cron (Every 5 seconds)

**Location**: [src/server.js](src/server.js#L350-L450) (approx)

**What it does**: 
- Checks for pending device pairing requests
- Auto-approves them with operator permissions
- Sends notification when a device is approved

**Notification sent**:
```javascript
await notifyCronJob(
  'Device Auto-Approved',
  `Device request ${requestId.slice(0, 8)}... approved with operator permissions`,
  { 
    requestId,
    role: 'operator',
    scopes: 'operator.read,operator.write,operator.admin'
  }
);
```

**When users see it**: 
- Badge appears on agent card: "1"
- Notification in panel: "⏰ Device Auto-Approved - Device request 1a2b3c4d... approved with operator permissions"
- Timestamp: "5 minutes ago"

### 2. Rate Limiter Cleanup (Every 60 seconds)

**Location**: [src/server.js](src/server.js#L564)

**What it does**: 
- Cleans up expired rate limit records
- Background maintenance task
- Currently does NOT send notifications (to avoid spam)

### 3. Session Cleanup (Every 5 minutes)

**Location**: [src/server.js](src/server.js#L589)

**What it does**:
- Cleans up expired setup sessions
- Background maintenance task
- Currently does NOT send notifications (to avoid spam)

## How to Add Notifications to New Cron Jobs

### Example: Add notification to an existing cron job

**Before** (no notifications):
```javascript
setInterval(() => {
  // Clean up old records
  const deleted = cleanupOldRecords();
  console.log(`[cleanup] deleted ${deleted} records`);
}, 60000); // Every minute
```

**After** (with notifications):
```javascript
setInterval(async () => {
  try {
    // Clean up old records
    const deleted = cleanupOldRecords();
    console.log(`[cleanup] deleted ${deleted} records`);
    
    // Only notify if something was deleted (avoid spam)
    if (deleted > 0) {
      await notifyCronJob(
        'Database Cleanup',
        `Deleted ${deleted} old records`,
        { recordsDeleted: deleted }
      );
    }
  } catch (error) {
    await notifyError(
      'Cleanup Failed',
      error.message,
      { error: error.toString() }
    );
  }
}, 60000); // Every minute
```

### Example: Create a new cron job with notifications

```javascript
import { notifyCronJob, notifyError, withNotification } from './notification-helper.js';

// Option 1: Manual notification
setInterval(async () => {
  const startTime = Date.now();
  try {
    // Do work
    const result = await performBackup();
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    // Send success notification
    await notifyCronJob(
      'Daily Backup',
      `Backed up ${result.files} files in ${duration}s`,
      { 
        filesBackedUp: result.files,
        bytesBackedUp: result.bytes,
        duration 
      }
    );
  } catch (error) {
    // Send error notification
    await notifyError(
      'Backup Failed',
      error.message,
      { error: error.toString(), duration: Math.round((Date.now() - startTime) / 1000) }
    );
  }
}, 24 * 60 * 60 * 1000); // Daily

// Option 2: Use withNotification wrapper (automatic success/error handling)
const performBackupWithNotification = withNotification('Daily Backup', performBackup);

setInterval(async () => {
  await performBackupWithNotification(); // Automatically sends notifications
}, 24 * 60 * 60 * 1000); // Daily
```

## Notification Best Practices for Cron Jobs

### ✅ DO:

1. **Only notify on meaningful events**
   ```javascript
   if (recordsProcessed > 0) {
     await notifyCronJob('Sync Complete', `Synced ${recordsProcessed} records`);
   }
   ```

2. **Include useful metrics in data**
   ```javascript
   await notifyCronJob('Backup Complete', 'Success', {
     files: 1234,
     bytes: 5678910,
     duration: 45,
     nextRun: new Date(Date.now() + 24*60*60*1000).toISOString()
   });
   ```

3. **Use descriptive titles**
   ```javascript
   await notifyCronJob('Database Cleanup', ...); // Good
   await notifyCronJob('Cleanup', ...);          // Too vague
   ```

4. **Handle errors gracefully**
   ```javascript
   try {
     await doWork();
     await notifyCronJob('Success', ...);
   } catch (error) {
     await notifyError('Failed', error);
     // Don't crash - continue running
   }
   ```

### ❌ DON'T:

1. **Don't notify on every iteration of fast loops**
   ```javascript
   // BAD - will spam notifications
   setInterval(() => notifyCronJob('Health Check', 'OK'), 1000);
   ```

2. **Don't include sensitive data**
   ```javascript
   // BAD - exposes credentials
   await notifyCronJob('API Call', `Called with key ${apiKey}`);
   
   // GOOD - generic message
   await notifyCronJob('API Call', 'API request completed', { endpoint: '/users' });
   ```

3. **Don't let notification failures crash your cron**
   ```javascript
   // GOOD - await but don't throw if notification fails
   await notifyCronJob('Task Done', 'Success').catch(err => {
     console.error('Notification failed:', err);
     // Continue execution
   });
   ```

## Frontend User Experience

When your cron job sends a notification:

1. **Agent Card Badge**: 
   - Red circle appears with number: "3"
   - Shows unread notification count

2. **Click Badge → Notification Panel Opens**:
   ```
   ┌─────────────────────────────────────┐
   │ 🔔 Notifications         [x]        │
   ├─────────────────────────────────────┤
   │ Filter: [All] Cron Task Error Info  │
   ├─────────────────────────────────────┤
   │ ⏰ Device Auto-Approved             │
   │    Device request 1a2b... approved  │
   │    5 minutes ago                    │
   ├─────────────────────────────────────┤
   │ ⏰ Daily Backup                     │
   │    Backed up 1,234 files in 45s    │
   │    2 hours ago                      │
   ├─────────────────────────────────────┤
   │ ⚠️ API Rate Limited                 │
   │    GitHub API rate limit exceeded   │
   │    1 day ago                        │
   └─────────────────────────────────────┘
   ```

3. **Filter by Type**:
   - Click "Cron" → shows only cron job notifications
   - Click "Error" → shows only errors
   - Auto-refreshes every 30 seconds

## Testing Your Cron Notifications

### 1. Test Locally

```bash
# Start your server
npm start

# In another terminal, send test notification
curl -X POST http://localhost:8080/api/notifications/test \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron",
    "title": "Test Cron Job",
    "message": "This is a test cron notification"
  }'
```

### 2. Check If Configured

```bash
curl http://localhost:8080/api/notifications/status \
  -H "Authorization: Bearer $WRAPPER_API_KEY"

# Expected response:
{
  "ok": true,
  "configured": true,  # ← Must be true
  "webhook": {
    "url": "[configured]",
    "tokenSet": true
  }
}
```

### 3. Monitor Real Cron Jobs

```bash
# Watch server logs for notification activity
tail -f /tmp/openclaw/*.log | grep -E "notification|cron"

# Look for:
[notification] webhook configured and ready
[gateway] ✅ Request 1a2b3c4d approved with operator role
[notification] sent: Device Auto-Approved
```

### 4. Use Test Script

```bash
./test-webhook-notifications.sh
```

## Rate Limiting

To prevent notification spam:

- **Limit**: 100 notifications per hour per agent
- **Window**: Rolling 1-hour window
- **Exceeded**: Notifications skipped silently (logged)
- **Status**: Check via `/api/notifications/status` API

**Example** - Smart rate limiting in cron:
```javascript
let lastNotificationTime = 0;
const MIN_INTERVAL = 60000; // 1 minute

setInterval(async () => {
  const now = Date.now();
  const result = await doWork();
  
  // Only notify if enough time passed OR significant event
  if (now - lastNotificationTime > MIN_INTERVAL || result.errors > 0) {
    await notifyCronJob('Cron Job', `Processed ${result.count} items`);
    lastNotificationTime = now;
  }
}, 10000); // Runs every 10s but notifies max once per minute
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Notifications not appearing | Check if `LAUNCHER_WEBHOOK_URL` and `LAUNCHER_AGENT_TOKEN` are set |
| Too many notifications | Implement conditional logic (only notify on errors or threshold events) |
| Rate limit exceeded | Reduce notification frequency or batch updates |
| Webhook timeout | Check launcher backend is reachable from agent |

## Example Cron Jobs to Add Notifications

Here are suggested cron jobs where notifications would be valuable:

1. **Health Check Monitor** (every 5 minutes)
   - Notify on failures only
   - Include system metrics

2. **Skills Auto-Update** (daily)
   - Notify when new skills installed
   - Report update count

3. **Wallet Balance Check** (hourly)
   - Notify if balance drops below threshold
   - Include current balance

4. **Log Rotation** (daily)
   - Notify after cleanup
   - Report space freed

5. **Model Performance Metrics** (every 6 hours)
   - Report usage stats
   - Notify on anomalies

## Summary

✅ **Cron jobs automatically send notifications to frontend when**:
- They complete successfully (type: `cron`)
- They encounter errors (type: `error`)
- Using `notifyCronJob()` or `notifyError()` functions

✅ **Users see notifications**:
- As badge on agent card
- In notification panel with filters
- With timestamps and full details

✅ **No manual intervention needed**:
- Launcher sets environment variables automatically
- Notification helper handles rate limiting
- Failures don't crash the cron jobs

📚 **More Info**: See [WEBHOOK-INTEGRATION.md](./WEBHOOK-INTEGRATION.md) for complete documentation.
