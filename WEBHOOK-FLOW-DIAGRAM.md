# 📊 Webhook Notification Flow Diagram

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenClaw Agent Server                        │
│                           (your-agent.railway.app)                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐         ┌─────────────────────────┐         │
│  │   Cron Jobs      │         │  notification-helper.js │         │
│  ├──────────────────┤         ├─────────────────────────┤         │
│  │ • Device Approval│────────>│ • notifyCronJob()       │         │
│  │ • Skill Installs │         │ • notifyTaskComplete()  │         │
│  │ • Cleanups       │         │ • notifyError()         │         │
│  │ • Backups        │         │ • notifyInfo()          │         │
│  └──────────────────┘         │                         │         │
│           │                   │ Rate Limiting: 100/hr   │         │
│           │                   │ Timeout: 5s             │         │
│           ▼                   └────────┬────────────────┘         │
│  ┌──────────────────┐                 │                           │
│  │  System Events   │                 │  HTTP POST               │
│  ├──────────────────┤                 │  {                        │
│  │ • Server Start   │────────────────>│    type: "cron",          │
│  │ • Gateway Start  │                 │    title: "...",          │
│  │ • Errors         │                 │    message: "...",        │
│  │ • Task Complete  │                 │    data: {...}            │
│  └──────────────────┘                 │  }                        │
│                                        │                           │
└────────────────────────────────────────┼───────────────────────────┘
                                         │
                    Environment Vars:    │
                    LAUNCHER_WEBHOOK_URL │
                    LAUNCHER_AGENT_TOKEN │
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Launcher Backend Server                         │
│                       (launcher.com)                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  POST /api/notifications/webhook/:agentId                          │
│  Headers: X-Agent-Token: <LAUNCHER_AGENT_TOKEN>                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────┐             │
│  │           Webhook Handler                        │             │
│  ├──────────────────────────────────────────────────┤             │
│  │ 1. Validate token                                │             │
│  │ 2. Check rate limit (100/hour)                   │             │
│  │ 3. Validate payload                              │             │
│  │ 4. Store in database                             │             │
│  │ 5. Return 200 OK                                 │             │
│  └───────────────────────┬──────────────────────────┘             │
│                          │                                         │
│                          ▼                                         │
│  ┌──────────────────────────────────────────────────┐             │
│  │           Notifications Database                 │             │
│  ├──────────────────────────────────────────────────┤             │
│  │ • id, agentId, type, title, message             │             │
│  │ • data (JSON), isRead, createdAt                │             │
│  │ • Indexed by agentId and createdAt              │             │
│  └───────────────────────┬──────────────────────────┘             │
│                          │                                         │
└──────────────────────────┼─────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Launcher Frontend UI                            │
│                       (React App)                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  GET /api/notifications?agentId=xxx&unreadOnly=true                │
│  Auto-refresh: Every 30 seconds                                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────┐             │
│  │           Agent Card                             │             │
│  ├──────────────────────────────────────────────────┤             │
│  │  ┌─────────────────────────────────────────┐    │             │
│  │  │  OpenClaw Agent             🔔 [3]      │    │             │
│  │  │  Status: Running                        │◄───┼─ Badge shows│
│  │  │  Memory: 512MB                          │    │   unread    │
│  │  └─────────────────────────────────────────┘    │   count     │
│  │                                                  │             │
│  │  Click badge ▼                                   │             │
│  │                                                  │             │
│  │  ┌─────────────────────────────────────────┐    │             │
│  │  │ 🔔 Notifications            [x]         │    │             │
│  │  ├─────────────────────────────────────────┤    │             │
│  │  │ Filter: [All] Cron Task Error Info      │    │             │
│  │  ├─────────────────────────────────────────┤    │             │
│  │  │ ⏰ Device Auto-Approved                 │    │             │
│  │  │    Device request 1a2b... approved      │    │             │
│  │  │    5 minutes ago                 [Read] │    │             │
│  │  ├─────────────────────────────────────────┤    │             │
│  │  │ ⏰ Skills Installed                     │    │             │
│  │  │    Installed 8 skills from cache        │    │             │
│  │  │    2 hours ago                   [Read] │    │             │
│  │  ├─────────────────────────────────────────┤    │             │
│  │  │ ⚠️ Gateway Exited                       │    │             │
│  │  │    Gateway process exited with code 1   │    │             │
│  │  │    1 day ago                     [Read] │    │             │
│  │  └─────────────────────────────────────────┘    │             │
│  └──────────────────────────────────────────────────┘             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Notification Types and Icons

```
┌─────────┬──────┬─────────────────────────────────────┐
│  Type   │ Icon │        Use Case                     │
├─────────┼──────┼─────────────────────────────────────┤
│  cron   │  ⏰  │ Scheduled/recurring tasks           │
│  task   │  ✓   │ User-initiated task completions     │
│  error  │  ⚠️  │ Errors and failures                 │
│  info   │  ℹ️  │ Status updates and general info     │
└─────────┴──────┴─────────────────────────────────────┘
```

## Sequence Diagram: Sending a Notification

```
Agent (Cron)    Helper          Launcher API      Database        Frontend
     │              │                 │               │               │
     │──doWork()────│                 │               │               │
     │              │                 │               │               │
     │──notify()───>│                 │               │               │
     │              │                 │               │               │
     │              │──checkRateLimit()               │               │
     │              │<─OK─────────────│               │               │
     │              │                 │               │               │
     │              │──POST webhook──>│               │               │
     │              │  + token        │               │               │
     │              │                 │               │               │
     │              │                 │──validate────>│               │
     │              │                 │               │               │
     │              │                 │──store──────>│               │
     │              │                 │<─saved───────│               │
     │              │                 │               │               │
     │              │<─200 OK─────────│               │               │
     │              │                 │               │               │
     │<─success─────│                 │               │               │
     │              │                 │               │               │
     │              │                 │               │   (30s later) │
     │              │                 │               │               │
     │              │                 │               │<──GET /api/───│
     │              │                 │               │   notifications│
     │              │                 │               │               │
     │              │                 │<──query──────>│               │
     │              │                 │               │               │
     │              │                 │──results────>│               │
     │              │                 │               │               │
     │              │                 │──JSON response───────────────>│
     │              │                 │               │               │
     │              │                 │               │  [Shows badge]│
```

## Data Flow

### 1. Notification Payload (Agent → Launcher)

```json
POST /api/notifications/webhook/agent-123
X-Agent-Token: secret-token-here

{
  "type": "cron",
  "title": "Device Auto-Approved",
  "message": "Device request 1a2b3c4d... approved with operator permissions",
  "data": {
    "requestId": "1a2b3c4d-5e6f-7890-abcd-ef1234567890",
    "role": "operator",
    "scopes": "operator.read,operator.write,operator.admin"
  }
}
```

### 2. Database Storage

```
Table: notifications
├── id: 1234
├── agentId: "agent-123"
├── type: "cron"
├── title: "Device Auto-Approved"
├── message: "Device request 1a2b..."
├── data: {"requestId": "...", "role": "operator"}
├── isRead: false
├── createdAt: "2026-03-14T10:30:00Z"
└── updatedAt: "2026-03-14T10:30:00Z"
```

### 3. Frontend Query

```json
GET /api/notifications?agentId=agent-123&unreadOnly=true

Response:
{
  "notifications": [
    {
      "id": 1234,
      "type": "cron",
      "title": "Device Auto-Approved",
      "message": "Device request 1a2b...",
      "data": {...},
      "isRead": false,
      "createdAt": "2026-03-14T10:30:00Z"
    }
  ],
  "total": 3,
  "unread": 3
}
```

## Error Handling Flow

```
Agent           Helper          Launcher         Frontend
  │               │                 │               │
  │──notify()────>│                 │               │
  │               │                 │               │
  │               │──POST webhook──>│               │
  │               │                 X               │
  │               │                 │ (timeout)     │
  │               │                 │               │
  │               │<─timeout────────│               │
  │               │                 │               │
  │               │  [log error]    │               │
  │               │  [don't throw] │               │
  │               │                 │               │
  │<─false───────│                 │               │
  │               │                 │               │
  │  [continue]   │                 │               │
  │  [no crash]   │                 │               │
```

## Rate Limiting Visualization

```
Time Window: 1 hour (rolling)
Max: 100 notifications

Hour 1:
[████████████████████████████] 28 sent
Remaining: 72

Hour 2:
[█████████████████████████████████████████████████] 50 sent
Remaining: 50

Hour 3 (exceed limit):
[██████████████████████████████████████████████████████████] 100 sent
[XXXX] 4 blocked ← Rate limit exceeded
Remaining: 0

Hour 4 (window resets):
[█████] 5 sent
Remaining: 95
```

## Integration Points in Code

```javascript
// src/server.js
import { notifyCronJob, notifyError, notifyInfo } from './notification-helper.js';

// 1. Server startup
app.listen(PORT, () => {
  notifyInfo('Agent Started', `Server on port ${PORT}`);
});

// 2. Gateway ready
async function ensureGatewayRunning() {
  // ... gateway starts ...
  await notifyInfo('Gateway Started', 'Gateway is ready');
}

// 3. Cron job (device approval)
setInterval(async () => {
  const devices = await checkDevices();
  if (devices.approved > 0) {
    await notifyCronJob('Device Approved', `${devices.approved} devices approved`);
  }
}, 5000);

// 4. Error handling
try {
  await doSomething();
} catch (error) {
  await notifyError('Operation Failed', error.message);
}

// 5. Task completion
async function installSkills() {
  const result = await copySkills();
  await notifyInfo('Skills Installed', `Installed ${result.count} skills`);
}
```

## Summary

1. **Agent** runs cron jobs and calls notification helper
2. **Helper** sends HTTP POST to launcher webhook with auth token
3. **Launcher** validates, rate-limits, and stores in database
4. **Frontend** polls API every 30s and displays in UI
5. **Users** see badge, click to view notifications, filter by type

All automatic - no manual configuration needed! 🎉
