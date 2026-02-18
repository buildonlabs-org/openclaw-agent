# OpenClaw Gateway - Railway Deployment

This Docker container runs the OpenClaw Gateway runtime on Railway.

## 🚀 Quick Start

### Local Testing

```bash
# Build the image
docker build -t openclaw-gateway .

# Run locally
docker run -p 8080:8080 \
  -e PORT=8080 \
  -e OPENAI_API_KEY=your-api-key \
  -e OPENCLAW_GATEWAY_TOKEN=test-token-123 \
  openclaw-gateway
```

Visit http://localhost:8080/health to verify it's running.

**Getting your token:**
Check the container logs for the auto-generated authentication token. Look for the line:
```
🔑 Copy this token to connect to your gateway:
   <your-64-character-token>
```

### Railway Deployment

1. **Create a new Railway project** (or use the launcher API)

2. **Set environment variables in Railway:**
   ```
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini (optional, defaults to gpt-4)
   OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32) (optional but recommended)
   ```

3. **Deploy from GitHub:**
   - Connect your GitHub repo
   - Railway will automatically detect the Dockerfile
   - Set root directory if needed
   - Deploy!

4. **Get your connection token:**
   - Check Railway logs during startup
   - Look for: "🔑 Copy this token to connect to your gateway:"
   - Copy the 64-character token
   - Use it to connect your OpenClaw client

5. **Health Check:**
   Railway automatically monitors `/health` endpoint

## 📋 Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for AI features | `sk-proj-...` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port (Railway sets this) | `8080` |
| `OPENCLAW_GATEWAY_PORT` | Internal gateway port | `18789` |
| `OPENCLAW_WORKSPACE` | Workspace directory | `/data/workspace` |
| `OPENAI_MODEL` | OpenAI model to use | `gpt-4` |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway authentication token | - |
| `OPENCLAW_PASSWORD` | Gateway authentication password | - |
| `DATABASE_URL` | PostgreSQL connection (if needed) | - |
| `REDIS_URL` | Redis connection (if needed) | - |

## 🔐 Device Pairing

OpenClaw requires device pairing for security. Remote connections need explicit approval.

### Web-Based Pairing (With Launcher)

The launcher provides a user-friendly device management interface:

1. **Deploy agent** via launcher
2. **Connect from client** (browser, CLI, etc.)
3. **Click "🔐 Pair Device"** button in launcher UI
4. **View pending devices** in modal
5. **Click "Approve"** next to pending device
6. **Refresh and connect** - device is now paired!

**API Endpoints:**
- `GET /api/devices` - List all devices (pending and approved)
- `POST /api/devices/approve` - Approve device by requestId
  ```json
  { "requestId": "abc123def456" }
  ```

### Manual Pairing (Standalone)

If not using the launcher, you can approve devices via Railway logs:

1. Get shell access to container (Railway CLI)
2. Run: `openclaw devices list`
3. Find pending device requestId
4. Run: `openclaw devices approve <requestId>`

### Authentication

**The OpenClaw gateway requires authentication.** You have three options:

1. **Set a persistent token** (recommended for production):
   ```bash
   OPENCLAW_GATEWAY_TOKEN=your-secret-token-here
   ```
   Generate a secure token: `openssl rand -hex 32`

2. **Set a password**:
   ```bash
   OPENCLAW_PASSWORD=your-password
   ```

3. **Use auto-generated token** (default):
   - If neither variable is set, the container automatically generates a temporary token
   - The token is displayed in the startup logs
   - Note: Token changes on each restart unless you set `OPENCLAW_GATEWAY_TOKEN`

## 🏗️ Architecture

```
Railway (Public) → :$PORT (health.js proxy)
                      ↓
                   :18789 (OpenClaw Gateway)
                      ↓
                   /data/workspace (persistent data)
```

- **health.js**: Node.js proxy server
  - Handles `/health` endpoint for Railway health checks
  - Proxies all other traffic to OpenClaw gateway
  - Supports WebSocket connections
  
- **OpenClaw Gateway**: Runs on internal port 18789
  - Handles AI agent requests
  - Manages workspace and sessions
  
- **Workspace**: `/data/workspace`
  - Persistent storage for agent data
  - Can be attached to Railway volume for persistence

## 🔧 Troubleshooting

### Check if gateway is running
```bash
# Inside container
curl http://localhost:8080/health
```

### View gateway logs
```bash
# In Railway dashboard
railway logs
```

### Common Issues

1. **"disconnected (1008): unauthorized" error:**
   - You need to use the gateway's authentication token
   - Check Railway logs for "🔑 Copy this token to connect to your gateway:"
   - Or set `OPENCLAW_GATEWAY_TOKEN` env var for persistent token
   - Configure your client with the token before connecting

2. **"disconnected (1008): pairing required" error:**
   - Device needs to be approved for security
   - **With launcher:** Click "🔐 Pair Device" button → Approve device
   - **Without launcher:** Use `/api/devices` and `/api/devices/approve` endpoints
   - Or get shell access and run: `openclaw devices approve <requestId>`

3. **Where do I find my token?**
   - Check Railway deployment logs during startup
   - Look for the startup output with the 🔑 emoji
   - If using launcher: token is in the launcher UI with copy button

4. **Gateway not starting:**
   - Check if `OPENAI_API_KEY` is set
   - View logs: `cat /tmp/openclaw-gateway.log`

2. **502 Bad Gateway:**
   - Gateway may still be initializing (wait 10-30 seconds)
   - Check gateway health: `curl http://localhost:18789/health`

3. **Port binding issues:**
   - Ensure Railway's `PORT` env var is being used
   - Default is 8080 if not set

## 📦 Files

- `Dockerfile` - Container image definition
- `start.sh` - Startup script (runs gateway + proxy)
- `health.js` - Health check & proxy server
- `.dockerignore` - Files excluded from image

## 🔐 Security Notes

- Never commit `.env` files with real API keys
- Use Railway's environment variables for secrets
- The gateway runs as root in the container (consider adding a non-root user for production)

## 📊 Monitoring

Railway provides:
- Built-in health checks via `/health`
- Automatic restarts on failure
- Logs aggregation
- Metrics dashboard

## 🤝 Support

For OpenClaw issues:
- Documentation: https://docs.openclaw.ai
- GitHub: https://github.com/openclaw/openclaw

For Railway issues:
- Documentation: https://docs.railway.app
- Discord: https://discord.gg/railway
