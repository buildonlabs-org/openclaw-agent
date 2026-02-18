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
  -e OPENCLAW_NO_AUTH=1 \
  openclaw-gateway
```

Visit http://localhost:8080/health to verify it's running.

### Railway Deployment

1. **Create a new Railway project** (or use the launcher API)

2. **Set environment variables in Railway:**
   ```
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini (optional, defaults to gpt-4)
   OPENCLAW_NO_AUTH=1 (disable auth for testing, or set a token)
   ```

3. **Deploy from GitHub:**
   - Connect your GitHub repo
   - Railway will automatically detect the Dockerfile
   - Set root directory if needed
   - Deploy!

4. **Health Check:**
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
| `OPENCLAW_NO_AUTH` | Disable gateway authentication | - |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway authentication token | - |
| `OPENCLAW_PASSWORD` | Gateway authentication password | - |
| `DATABASE_URL` | PostgreSQL connection (if needed) | - |
| `REDIS_URL` | Redis connection (if needed) | - |

### Authentication

The OpenClaw gateway requires authentication by default. Configure one of these options:

1. **Disable authentication** (for testing/internal use):
   ```bash
   OPENCLAW_NO_AUTH=1
   ```

2. **Token authentication** (recommended):
   ```bash
   OPENCLAW_GATEWAY_TOKEN=your-secret-token
   ```

3. **Password authentication**:
   ```bash
   OPENCLAW_PASSWORD=your-password
   ```

If no authentication is configured, the container will attempt to start with `--no-auth` flag.

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
   - The gateway requires authentication
   - Set `OPENCLAW_NO_AUTH=1` to disable auth (for testing)
   - Or set `OPENCLAW_GATEWAY_TOKEN` or `OPENCLAW_PASSWORD`
   - Restart the service after updating environment variables

2. **Gateway not starting:**
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
