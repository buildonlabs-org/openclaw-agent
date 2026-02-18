# OpenClaw Gateway - Railway Deployment

Deploy an OpenClaw AI gateway to Railway with a **web-based setup wizard** — no command-line configuration needed!

## ✨ Features

- 🧙 **Web Setup Wizard** at `/setup` - Configure through your browser
- 🤖 **Multi-Provider Support** - OpenAI, Anthropic, Google Gemini, OpenRouter
- ⚙️ **Auto-Configuration** - Gateway settings applied automatically
- 💬 **Channel Integration** - Connect Telegram, Discord bots
- 🔐 **Device Management** - Approve pairing requests via web UI
- 💾 **Persistent State** - Configuration survives redeploys
- 🔄 **Backward Compatible** - Works with existing launcher apps

## 🚀 Quick Start

### Railway Deployment

1. **Deploy to Railway:**
   - Fork this repository
   - Connect to Railway
   - Railway auto-detects Dockerfile and deploys

2. **Set Required Environment Variable:**
   ```
   SETUP_PASSWORD=your-secure-password-here
   ```
   This password protects access to the `/setup` wizard.

3. **Configure via Web Wizard:**
   - Visit `https://your-app.railway.app/setup`
   - Enter your `SETUP_PASSWORD` when prompted (Basic Auth)
   - Follow the 3-step wizard:
     - **Step 1**: Choose AI provider and enter API key
     - **Step 2**: Connect Telegram/Discord (optional)
     - **Step 3**: Review and run setup
   - Gateway starts automatically!

4. **Access Your Gateway:**
   - `/openclaw` - OpenClaw Control UI
   - `/setup` - Configuration wizard (password protected)
   - `/api/devices` - Device management API (for launcher apps)

### Local Testing

```bash
# Build the image
docker build -t openclaw-gateway .

# Run locally
docker run -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test123 \
  -v $(pwd)/.data:/data \
  openclaw-gateway
```

Visit http://localhost:8080/setup (password: `test123`) to configure.

## 📋 Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `SETUP_PASSWORD` | Password for `/setup` wizard access | `mySecurePassword123` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port (Railway sets this automatically) | `8080` |
| `INTERNAL_GATEWAY_PORT` | Gateway port (internal only) | `18789` |
| `OPENCLAW_WORKSPACE_DIR` | Workspace directory | `/data/workspace` |
| `OPENCLAW_STATE_DIR` | State/config directory | `/data/.openclaw` |
| `OPENCLAW_GATEWAY_TOKEN` | Gateway auth token (auto-generated if not set) | - |

**Note:** AI provider API keys are configured through the `/setup` wizard, not environment variables.

## 🧙 Setup Wizard

The `/setup` wizard provides a user-friendly interface to configure your gateway without touching the command line.

### Access

- **URL**: `https://your-app.railway.app/setup`
- **Authentication**: Basic auth with `SETUP_PASSWORD`
- **Username**: (any value, ignored)
- **Password**: Your `SETUP_PASSWORD`

### Configuration Steps

**Step 1: Choose AI Provider**
- Select from supported providers:
  - **OpenAI** - GPT-4, GPT-4o, GPT-4o-mini
  - **Anthropic** - Claude Opus, Sonnet, Haiku
  - **Google** - Gemini Pro, Gemini Flash
  - **OpenRouter** - Access to 100+ models
- Enter your API key
- Optionally specify a model (defaults to provider's recommended model)

**Step 2: Connect Channels (Optional)**
- **Telegram**: Enter bot token from [@BotFather](https://t.me/BotFather)
  - Run `/newbot` in Telegram
  - Copy the token (looks like `123456789:ABCdef...`)
- **Discord**: Enter bot token from [Developer Portal](https://discord.com/developers/applications)
  - Create an application
  - Create a bot and copy the token

**Step 3: Review & Run**
- Review your configuration summary
- Click "Run Setup" to initialize the gateway
- Monitor the output log for any issues
- Gateway starts automatically after successful setup

### Management Features

Once configured, the setup wizard provides administrative tools:

- **Open Gateway UI** - Direct link to OpenClaw Control UI
- **Run Doctor** - Diagnose and repair configuration issues
- **Approve Pairing** - Grant DM access for Telegram/Discord users
  - Select channel (telegram/discord)
  - Enter pairing code provided by user
  - Approve to grant access
- **Reset Setup** - Delete configuration to start over
  - Useful for changing providers or fixing broken config
  - Deletes `/data/.openclaw/openclaw.json`

## 🔧 Configuration Details

The wrapper server (`src/server.js`) manages all gateway configuration:

### Automatic Configuration

When you complete the setup wizard, the wrapper:

1. **Runs Onboarding**: `openclaw onboard --non-interactive` with your provider credentials
2. **Sets Gateway Token**: Stores authentication token in config file
3. **Configures Security**: Sets `gateway.controlUi.allowInsecureAuth=true` (bypasses device pairing for Control UI)
4. **Sets Trusted Proxies**: Configures `127.0.0.1` for Railway networking
5. **Configures Model**: Sets your specified model or provider default
6. **Sets Up Channels**: Writes Telegram/Discord config if provided
7. **Starts Gateway**: Launches gateway process with all settings applied

### Configuration Persistence

- Config stored in `/data/.openclaw/openclaw.json`
- Gateway token stored in `/data/.openclaw/gateway.token`
- Files persist across redeploys via Railway volumes
- No reconfiguration needed after restarts

### Gateway Authentication

The wrapper **automatically injects** the gateway authentication token into all requests:

```javascript
// Every request to the gateway includes this header:
Authorization: Bearer <your-gateway-token>
```

This means:
- Frontend launcher apps don't need to send the token
- Users connect without manual authentication
- Token security maintained (not exposed publicly)

## 🔌 API Endpoints

### Gateway Routes

All routes except `/setup` and `/api/*` are proxied to the OpenClaw gateway:

- `GET /` - Gateway home
- `GET /openclaw` - Control UI (auto-includes token)
- `GET /health` - Health check endpoint
- `WebSocket /` - Gateway WebSocket connections

### Setup Wizard (Password Protected)

- `GET /setup` - Setup wizard UI
- `GET /setup/api/status` - Get configuration status
- `POST /setup/api/run` - Run onboarding with config
- `POST /setup/api/reset` - Delete config (reset)
- `POST /setup/api/doctor` - Run diagnostics
- `POST /setup/api/pairing/approve` - Approve device pairing
- `GET /setup/api/debug` - System debug info

### Device Management (Public, for Launcher Apps)

- `GET /api/devices` - List pending and approved devices
- `POST /api/devices/approve` - Approve a device by requestId

**Example:**
```bash
# List devices
curl https://your-app.railway.app/api/devices

# Approve device
curl -X POST https://your-app.railway.app/api/devices/approve \
  -H "Content-Type: application/json" \
  -d '{"requestId": "abc123def456"}'
```

## 🛠️ Troubleshooting

### Chat Not Responding

1. Visit `/setup` and click **Run Doctor**
2. Check the output for errors
3. Verify your API key is correct
4. Try **Reset Setup** and reconfigure with a fresh API key

### Gateway Won't Start

1. Check Railway logs for errors:
   - Go to Deployments → View Logs
   - Look for `[gateway]` prefixed messages
2. Common issues:
   - Invalid API key (test it manually)
   - Model not available with your API key
   - Network connectivity issues
3. Try Reset Setup and use a different model

### Can't Access /setup

1. Verify `SETUP_PASSWORD` is set in Railway Variables
2. Check you're using Basic auth (browser will prompt)
3. Username can be anything (it's ignored), password must match `SETUP_PASSWORD`
4. Clear browser auth cache: Close all tabs and reopen

### Telegram/Discord Not Working

1. **For Gateway Connections**: Device pairing is automatically bypassed
2. **For Channel DMs**: Users need pairing approval:
   - User sends a message to your bot
   - User receives pairing code
   - Admin visits `/setup` → Approve Pairing
   - Enter channel (telegram/discord) and code
   - Click Approve
3. **Bot Token Invalid**: 
   - Verify token in Bot settings
   - Reset Setup and re-enter token

### Configuration Won't Persist

1. Verify Railway volume is mounted at `/data`
2. Check logs for permission errors
3. Ensure `OPENCLAW_STATE_DIR=/data/.openclaw`

## 🏗️ Architecture

### Components

```
User → Railway → Wrapper Server (Express) → OpenClaw Gateway
                      ↓
                  /setup wizard
                  /api/devices
```

**Wrapper Server** (`src/server.js`):
- Express.js HTTP server
- Serves `/setup` wizard
- Manages gateway lifecycle
- Proxies requests to gateway with auto-injected auth
- Handles device management API

**OpenClaw Gateway**:
- Runs on internal port 18789
- Managed by wrapper (auto-start, restart)
- Configured via `openclaw.json`

### Request Flow

1. **User visits `/openclaw`**
   - Wrapper intercepts request
   - Injects `Authorization: Bearer <token>` header
   - Proxies to `http://127.0.0.1:18789/openclaw`
   - Gateway responds with authenticated UI

2. **User visits `/setup`**
   - Wrapper requires Basic auth (`SETUP_PASSWORD`)
   - Serves setup wizard from `src/public/setup.html`
   - Wizard makes API calls to `/setup/api/*`
   - Configuration applied to gateway

3. **Launcher connects**
   - Launcher makes requests to Railway URL
   - Wrapper proxies to gateway with auth
   - No token needed from launcher (wrapper adds it)

## 🔒 Security

### Setup Wizard Protection

- Protected by Basic authentication
- Password set via `SETUP_PASSWORD` environment variable
- Rate limited: 50 requests per minute per IP
- Should use a strong, unique password

### Gateway Authentication

- Token-based authentication (Bearer token)
- Token auto-generated on first run (64 chars)
- Stored in `/data/.openclaw/gateway.token`
- Injected by wrapper (not exposed publicly)

### Best Practices

1. **Use Strong Passwords**: `SETUP_PASSWORD` should be long and random
2. **Rotate API Keys**: Change provider API keys regularly
3. **Monitor Access**: Check Railway logs for suspicious activity
4. **Limit /setup Access**: Only visit when needed, don't share password
5. **Use HTTPS**: Railway provides this automatically

## 📦 What's Included

```
openclaw-agent/
├── Dockerfile          # Container definition
├── package.json        # Node.js dependencies
├── start.sh           # Wrapper startup script
├── health.js          # Legacy health server (backward compat)
├── src/
│   ├── server.js      # Express wrapper server
│   └── public/
│       ├── setup.html     # Setup wizard UI
│       └── loading.html   # Gateway loading page
└── README.md          # This file
```

## 🤝 Contributing

This template is based on the excellent work from [arjunkomath/openclaw-railway-template](https://github.com/arjunkomath/openclaw-railway-template).

Contributions welcome! Please open issues or PRs.

## 📄 License

MIT License - feel free to use this template for your own deployments.

## 🆘 Support

- **OpenClaw Docs**: https://docs.openclaw.com
- **GitHub Issues**: Open an issue in this repository
- **Discord**: Join the OpenClaw community

---

**Happy coding with OpenClaw!** 🦞
