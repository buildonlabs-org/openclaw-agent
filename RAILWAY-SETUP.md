# Railway Deployment Setup

## Quick Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/your-template-id)

## Manual Setup

### 1. Fork/Clone Repository

```bash
git clone https://github.com/buildonlabs-org/openclaw-agent.git
cd openclaw-agent
```

### 2. Create Railway Project

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Create new project
railway init

# Link to project
railway link
```

### 3. Configure Environment Variables

**Required:**

```bash
railway variables set SETUP_PASSWORD="your_secure_password"
railway variables set WRAPPER_API_KEY="your_api_key_for_endpoints"
```

**Optional (for web search):**

```bash
railway variables set BRAVE_API_KEY="your_brave_api_key"
```

Get free Brave Search API key: https://brave.com/search/api/ (2,000 queries/month free)

**Optional (for specific AI models):**

```bash
railway variables set OPENAI_API_KEY="sk-..."
railway variables set ANTHROPIC_API_KEY="sk-ant-..."
railway variables set GOOGLE_API_KEY="..."
```

### 4. Deploy

```bash
git push origin main
```

Railway will automatically:
- ✅ Build using Dockerfile
- ✅ Create a 5GB persistent volume at `/data`
- ✅ Deploy the agent
- ✅ Assign a public URL

### 5. Access Your Agent

**Setup Wizard:**
```
https://your-app.up.railway.app/setup
```

**API Endpoints:**
```bash
# Health check
curl https://your-app.up.railway.app/health

# Chat with agent
curl -X POST \
  -H "Authorization: Bearer YOUR_WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}' \
  https://your-app.up.railway.app/api/chat
```

## Persistent Storage

The `railway.toml` configuration automatically creates a volume:

```toml
[[volumes]]
name = "data"
mountPath = "/data"
sizeGB = 5
```

This persists:
- Agent configuration (`/data/.openclaw/openclaw.json`)
- Device pairing keys (`/data/.openclaw/device-key.pem`)
- Installed skills (`/data/workspace`)
- Session data

## Environment Variables Reference

See [.env.example](.env.example) for complete list of supported environment variables.

## API Endpoints

All `/api/*` endpoints require `Authorization: Bearer YOUR_WRAPPER_API_KEY` header.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Send message to agent |
| `/api/skills` | GET | List installed skills |
| `/api/skills/install` | POST | Install a skill |
| `/api/devices` | GET | List paired devices |
| `/api/status` | GET | Get agent status |

See [API.md](API.md) for complete API documentation.

## Troubleshooting

### Agent shows "configured: false"
- Ensure volume is created (check Railway dashboard → Data tab)
- Configuration is lost on first deploy without volume

### Search not working
- Add `BRAVE_API_KEY` environment variable
- Restart agent after adding env vars

### Device pairing errors
- Fixed in latest version (auto-approval enabled)
- Check logs for pairing status

### CORS errors from frontend
- Latest version includes CORS support
- Allows all Railway domains and localhost

## Cost Estimate

**Railway:**
- Free tier: $5/month credit
- Typical usage: ~$3-5/month for small workloads
- Volume storage: $0.25/GB/month (5GB = $1.25/month)

**API Costs:**
- Brave Search: 2,000 queries/month free
- OpenAI/Anthropic: Pay per token usage
- Agent can use any model provider

## Support

Issues: https://github.com/buildonlabs-org/openclaw-agent/issues
