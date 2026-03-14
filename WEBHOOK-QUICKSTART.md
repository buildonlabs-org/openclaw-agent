# 🔔 Notification System Quick Reference

## Environment Variables (Auto-configured by Launcher)

```bash
LAUNCHER_WEBHOOK_URL=https://launcher.com/api/notifications/webhook/{serviceId}
LAUNCHER_AGENT_TOKEN=<unique-token>
```

## Notification Helper Functions

```javascript
import { notifyCronJob, notifyTaskComplete, notifyError, notifyInfo } from './notification-helper.js';

// Cron job completion
await notifyCronJob('Job Name', 'Completed in 5s', { records: 100 });

// Task completion
await notifyTaskComplete('Task Name', 'Success message', { items: 50 });

// Error notification
await notifyError('Error Title', error, { context: 'details' });

// Info/status notification
await notifyInfo('Title', 'Message', { key: 'value' });
```

## Notification Types

| Type | Icon | Use Case |
|------|------|----------|
| `cron` | ⏰ | Scheduled/recurring tasks |
| `task` | ✓ | User-initiated tasks |
| `error` | ⚠️ | Errors and failures |
| `info` | ℹ️ | Status updates |

## Current Integrations

✅ **Automatic Notifications Sent For:**
- Server startup
- Gateway start/stop/crash
- Device auto-approval
- Skills installation
- All major errors

## API Endpoints

```bash
# Check status
GET /api/notifications/status

# Send test notification
POST /api/notifications/test
{
  "type": "info",
  "title": "Test",
  "message": "Hello"
}
```

## Rate Limits

- **100 notifications per hour** per agent
- Title max: 200 characters
- Message max: 1000 characters
- Timeout: 5 seconds per request

## Testing

```bash
# Run test suite
./test-webhook-notifications.sh

# Check if configured
curl http://localhost:8080/api/notifications/status \
  -H "Authorization: Bearer $WRAPPER_API_KEY"

# Send test notification
curl -X POST http://localhost:8080/api/notifications/test \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"info","title":"Test","message":"Testing"}'
```

## Adding New Notifications

```javascript
// Option 1: Direct call
await notifyInfo('New Feature', 'Feature activated', { feature: 'X' });

// Option 2: Wrap function (auto success/error notifications)
import { withNotification } from './notification-helper.js';

const myTask = withNotification('My Task', async () => {
  // Your code here
  return { recordsProcessed: 100 };
});

await myTask(); // Automatically sends success or error notification
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No notifications appearing | Check `/api/notifications/status` |
| Rate limit exceeded | Wait for window reset (check `windowRemainingMs`) |
| Webhook timeout | Check network/launcher connectivity |
| Not configured | Set environment variables |

## Logs

```bash
# Server logs
tail -f /tmp/openclaw/*.log | grep notification

# Look for:
[notification] webhook configured and ready
[notification] rate limit exceeded
[notification] webhook failed: <error>
```

## Documentation

- **Full Docs**: [WEBHOOK-INTEGRATION.md](./WEBHOOK-INTEGRATION.md)
- **Launcher Docs**: `AGENT_WEBHOOK_INTEGRATION.md` in openclaw-launcher-2
- **Test Script**: `./test-webhook-notifications.sh`

---

**Status**: ✅ Integrated and ready to use
