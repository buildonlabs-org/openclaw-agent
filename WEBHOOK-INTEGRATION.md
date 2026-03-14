# 📬 Webhook Notification Integration

## Overview

The OpenClaw Agent now sends real-time notifications to the launcher frontend via webhooks. This enables users to receive updates about cron jobs, task completions, errors, and system events directly in the launcher UI.

## ✅ What's Implemented

### Notification Helper Module
- **Location**: `src/notification-helper.js`
- **Features**:
  - Four notification types: `cron`, `task`, `error`, `info`
  - Automatic rate limiting (100 notifications/hour)
  - Graceful error handling (failures don't crash the agent)
  - Configurable webhook endpoint and authentication
  - Automatic title/message truncation to fit limits

### Integrated Notification Points

#### 1. **System Lifecycle Events**
- ✅ Agent server startup
- ✅ Gateway started successfully
- ✅ Gateway exit/crash with auto-restart info

#### 2. **Cron Jobs**
- ✅ Device auto-approval (runs every 5 seconds, notifies on actual approvals)
- ✅ Rate limiter cleanup (background)
- ✅ Session cleanup (background)

#### 3. **Task Completions**
- ✅ Skills cache installation
- ✅ Skills copied from Docker image

#### 4. **Error Notifications**
- ✅ Device approval failures
- ✅ Gateway exit with non-zero code
- ✅ Skill cache copy errors
- ✅ Skill installation failures

## 🔧 Configuration

### Environment Variables

These are automatically set by the launcher when deploying agents:

```bash
LAUNCHER_WEBHOOK_URL=https://launcher.com/api/notifications/webhook/{serviceId}
LAUNCHER_AGENT_TOKEN=<unique-token-for-this-agent>
```

**No changes needed** - these are configured automatically during deployment.

### Local Development/Testing

If testing locally without the launcher:

```bash
# Set test webhook endpoint
export LAUNCHER_WEBHOOK_URL=https://your-launcher-url.com/api/notifications/webhook/test-agent-id
export LAUNCHER_AGENT_TOKEN=your-test-token

# Start the server
npm start
```

## 📡 API Endpoints

### Check Notification Status

```bash
GET /api/notifications/status
Authorization: Bearer <WRAPPER_API_KEY>
```

**Response:**
```json
{
  "ok": true,
  "configured": true,
  "webhook": {
    "url": "[configured]",
    "tokenSet": true
  },
  "rateLimit": {
    "count": 5,
    "limit": 100,
    "remaining": 95,
    "windowRemainingMs": 3540000
  }
}
```

### Send Test Notification

```bash
POST /api/notifications/test
Authorization: Bearer <WRAPPER_API_KEY>
Content-Type: application/json

{
  "type": "info",
  "title": "Test Alert",
  "message": "Testing notification system"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Test notification sent successfully",
  "type": "info",
  "title": "Test Alert",
  "sent": true
}
```

**Supported types**: `cron`, `task`, `error`, `info`

## 🎯 Current Notification Types

| Event | Type | Title | When |
|-------|------|-------|------|
| Server Start | `info` | OpenClaw Agent Started | Server starts listening |
| Gateway Start | `info` | OpenClaw Gateway Started | Gateway becomes ready |
| Gateway Exit | `error` | Gateway Exited | Gateway crashes (non-zero exit) |
| Device Approved | `cron` | Device Auto-Approved | Device pairing request approved |
| Device Approval Failed | `error` | Device Approval Failed | Failed to approve device |
| Skills Installed | `info` | Skills Installed | Skills copied from cache |
| Skill Install Failed | `error` | Skill Installation Failed | Error copying skills |
| Skill Cache Error | `error` | Skill Cache Error | Error during cache operation |

## 🚀 How It Works

### 1. **Automatic Notifications**

The server automatically sends notifications when key events occur:

```javascript
// Gateway starts successfully
await notifyInfo(
  'OpenClaw Gateway Started',
  `Gateway is online and ready at ${GATEWAY_TARGET}`,
  { port: INTERNAL_GATEWAY_PORT, workspace: WORKSPACE_DIR, pid: gatewayProc?.pid }
);

// Device auto-approved
await notifyCronJob(
  'Device Auto-Approved',
  `Device request ${requestId.slice(0, 8)}... approved with operator permissions`,
  { requestId, role: 'operator', scopes: 'operator.read,operator.write,operator.admin' }
);

// Error handling
await notifyError(
  'Gateway Exited',
  `Gateway process exited unexpectedly with code ${code}`,
  { exitCode: code, signal, willRestart: true }
);
```

### 2. **Rate Limiting**

The helper automatically enforces rate limits:
- **100 notifications per hour** per agent
- Counters reset every hour
- Failed attempts don't count against the limit
- Rate limit status available via API

### 3. **Graceful Degradation**

If webhooks fail or aren't configured:
- Notifications are skipped silently
- Server continues normal operation
- Errors logged but don't crash the agent
- No impact on core functionality

## 📊 Monitoring

### Check If Notifications Are Working

```bash
# Check configuration
curl -X GET http://localhost:8080/api/notifications/status \
  -H "Authorization: Bearer $WRAPPER_API_KEY"

# Send test notification
curl -X POST http://localhost:8080/api/notifications/test \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "info", "title": "Test", "message": "Hello from agent"}'
```

### Server Logs

The helper logs its status:

```
[notification] webhook configured and ready
[notification] rate limit exceeded, skipping notification
[notification] webhook failed: 401 Unauthorized
[notification] webhook timeout
```

### In the Launcher Frontend

Notifications appear as:
1. **Badge** on agent card with unread count
2. **Notification panel** with all notifications
3. **Type filtering** (cron, task, error, info)
4. **Timestamps** ("5 minutes ago")
5. **Auto-refresh** every 30 seconds

## 🔮 Future Enhancements

### Potential Additional Notification Points

More notifications can be added for:
- Model selection changes
- Wallet operations (balance changes, transactions)
- Skill installations/removals
- Configuration updates
- Long-running task completions
- API endpoint usage metrics
- Health check failures

### Adding New Notifications

To add notifications to new events, simply import and call:

```javascript
import { notifyCronJob, notifyError, notifyInfo, notifyTaskComplete } from './notification-helper.js';

// In your code
await notifyInfo('New Feature Activated', 'Feature X is now enabled', { feature: 'X' });
```

## 🐛 Troubleshooting

### Notifications Not Appearing

1. **Check configuration**:
   ```bash
   curl http://localhost:8080/api/notifications/status \
     -H "Authorization: Bearer $WRAPPER_API_KEY"
   ```

2. **Verify environment variables**:
   ```bash
   echo $LAUNCHER_WEBHOOK_URL
   echo $LAUNCHER_AGENT_TOKEN
   ```

3. **Test notification**:
   ```bash
   curl -X POST http://localhost:8080/api/notifications/test \
     -H "Authorization: Bearer $WRAPPER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"type":"info","title":"Test","message":"Testing"}'
   ```

4. **Check server logs** for `[notification]` entries

### Rate Limit Exceeded

If hitting rate limits:
- Current limit: 100 notifications/hour
- Check status: `/api/notifications/status`
- Wait for window to reset (shown in `windowRemainingMs`)
- Consider batching similar events

### Webhook Timeouts

If webhooks are timing out:
- Current timeout: 5 seconds
- Check network connectivity
- Verify launcher is accessible
- Check launcher server health

## 📚 Related Documentation

- **Launcher Integration**: See `AGENT_WEBHOOK_INTEGRATION.md` in openclaw-launcher-2 repo
- **Frontend UI**: Notification panel and badge implementation
- **API Reference**: Full API spec in launcher documentation

## ✨ Benefits

1. **Real-time Updates**: Users see what's happening inside their agents
2. **Error Visibility**: Issues are surfaced immediately
3. **Task Tracking**: Know when cron jobs complete
4. **System Monitoring**: Track agent health and lifecycle
5. **Better UX**: No need to SSH or check logs manually

---

**Integration Status**: ✅ Live and ready to use

**No action required** - notifications work automatically when environment variables are set by the launcher!
