import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import httpProxy from "http-proxy";
import { WebSocketServer } from "ws";

import { OpenClawGatewayClient } from "./gatewayClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const STATE_DIR = process.env.OPENCLAW_STATE_DIR?.trim() || "/data/.openclaw";
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR?.trim() || "/data/workspace";
const SETUP_PASSWORD = process.env.SETUP_PASSWORD?.trim();

// Gateway token resolution
function resolveGatewayToken() {
  const envToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (envToken) return envToken;
  
  const tokenFile = path.join(STATE_DIR, "gateway.token");
  if (fs.existsSync(tokenFile)) {
    return fs.readFileSync(tokenFile, "utf8").trim();
  }
  
  const token = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(tokenFile, token);
  console.log(`[wrapper] generated new gateway token: ${token.slice(0, 12)}...`);
  return token;
}

const OPENCLAW_GATEWAY_TOKEN = resolveGatewayToken();
process.env.OPENCLAW_GATEWAY_TOKEN = OPENCLAW_GATEWAY_TOKEN;

// Wrapper API key for headless operations
const WRAPPER_API_KEY = process.env.WRAPPER_API_KEY?.trim() || OPENCLAW_GATEWAY_TOKEN;

const INTERNAL_GATEWAY_PORT = Number.parseInt(process.env.INTERNAL_GATEWAY_PORT ?? "18789", 10);
const INTERNAL_GATEWAY_HOST = process.env.INTERNAL_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_TARGET = `http://${INTERNAL_GATEWAY_HOST}:${INTERNAL_GATEWAY_PORT}`;

// Use openclaw CLI binary (installed via install.sh)
const OPENCLAW_CLI = process.env.OPENCLAW_CLI?.trim() || "openclaw";

let cachedOpenclawVersion = null;
let cachedChannelsHelp = null;

async function getOpenclawInfo() {
  if (!cachedOpenclawVersion) {
    const [version, channelsHelp] = await Promise.all([
      runCmd(OPENCLAW_CLI, ["--version"]),
      runCmd(OPENCLAW_CLI, ["channels", "add", "--help"]),
    ]);
    cachedOpenclawVersion = version.output.trim();
    cachedChannelsHelp = channelsHelp.output;
  }
  return { version: cachedOpenclawVersion, channelsHelp: cachedChannelsHelp };
}

function configPath() {
  return process.env.OPENCLAW_CONFIG_PATH?.trim() || path.join(STATE_DIR, "openclaw.json");
}

function isConfigured() {
  try {
    return fs.existsSync(configPath());
  } catch {
    return false;
  }
}

let gatewayProc = null;
let gatewayStarting = null;
let shuttingDown = false;
let restartAttempts = 0;
const MAX_RESTART_DELAY = 30000; // Max 30 seconds between restarts

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForGatewayReady(opts = {}) {
  const maxWait = opts.maxWait || 90000; // 90 seconds (gateway can take 30-40s to start)
  const started = Date.now();
  
  while (Date.now() - started < maxWait) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${GATEWAY_TARGET}/`, { 
        signal: controller.signal,
        headers: { Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}` }
      });
      clearTimeout(timeout);
      if (res) {
        const elapsed = Math.round((Date.now() - started) / 1000);
        console.log(`[gateway] ready at ${GATEWAY_TARGET} (${elapsed}s)`);
        return true;
      }
    } catch (err) {
      // Continue waiting
    }
    await sleep(500);
  }
  
  console.error(`[gateway] failed to become ready after ${maxWait}ms`);
  return false;
}

async function killExistingGatewayProcesses() {
  try {
    // Find and kill any openclaw gateway processes
    const { stdout } = await new Promise((resolve, reject) => {
      childProcess.exec("pgrep -f 'openclaw gateway run'", (error, stdout, stderr) => {
        // pgrep returns exit code 1 if no processes found, which is fine
        resolve({ stdout, stderr, error });
      });
    });
    
    if (stdout.trim()) {
      const pids = stdout.trim().split('\n');
      console.log(`[gateway] found existing processes: ${pids.join(', ')}`);
      
      for (const pid of pids) {
        try {
          // Skip if it's the current process or our child
          if (gatewayProc && String(gatewayProc.pid) === pid) continue;
          
          console.log(`[gateway] killing orphaned process ${pid}...`);
          process.kill(Number(pid), 'SIGTERM');
          
          // Wait a bit for graceful shutdown
          await sleep(1000);
          
          // Force kill if still running
          try {
            process.kill(Number(pid), 0); // Check if still exists
            console.log(`[gateway] force killing process ${pid}...`);
            process.kill(Number(pid), 'SIGKILL');
          } catch {
            // Process already dead
          }
        } catch (err) {
          // Process might already be dead, ignore
          console.log(`[gateway] process ${pid} cleanup: ${err.message}`);
        }
      }
      
      // Give processes time to fully exit
      await sleep(500);
    }
  } catch (err) {
    console.error(`[gateway] error cleaning up processes: ${err.message}`);
  }
}

async function startGateway() {
  if (gatewayProc) return;
  if (!isConfigured()) throw new Error("Gateway cannot start: not configured");

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  // Kill any orphaned gateway processes first
  await killExistingGatewayProcesses();

  // Apply any pending doctor fixes automatically
  try {
    console.log("[gateway] checking for doctor fixes...");
    const result = await runCmd(OPENCLAW_CLI, ["doctor", "--fix"], {
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
      },
    });
    if (result.output.trim()) {
      console.log("[gateway] applied doctor fixes");
    }
  } catch (err) {
    // Non-critical, continue anyway
    console.log(`[gateway] doctor check: ${err.message}`);
  }

  // Configure control UI authentication bypass
  try {
    console.log("[gateway] configuring control UI settings...");
    await runCmd(OPENCLAW_CLI, [
      "config",
      "set",
      "gateway.controlUi.allowInsecureAuth",
      "true",
    ]);
    console.log("[gateway] allowInsecureAuth: true");
  } catch (err) {
    console.log(`[gateway] allowInsecureAuth config warning: ${err.message}`);
  }

  // Disable device pairing requirement globally
  try {
    console.log("[gateway] disabling device pairing...");
    await runCmd(OPENCLAW_CLI, [
      "config",
      "set",
      "gateway.devices.requirePairing",
      "false",
    ]);
    console.log("[gateway] device pairing disabled");
  } catch (err) {
    console.log(`[gateway] device pairing config warning: ${err.message}`);
  }

  // Alternative: allow unpaired device connections
  try {
    await runCmd(OPENCLAW_CLI, [
      "config",
      "set",
      "gateway.devices.autoApprove",
      "true",
    ]);
    console.log("[gateway] device auto-approve enabled");
  } catch (err) {
    console.log(`[gateway] device auto-approve config warning: ${err.message}`);
  }

  // Configure allowed origins for Railway/external access
  try {
    console.log("[gateway] configuring CORS origins...");
    const allowedOrigins = ["http://localhost:8080", "http://127.0.0.1:8080"];
    
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
      allowedOrigins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
    }
    if (process.env.RAILWAY_STATIC_URL) {
      allowedOrigins.push(process.env.RAILWAY_STATIC_URL);
    }
    allowedOrigins.push("https://*.railway.app");
    
    await runCmd(OPENCLAW_CLI, [
      "config",
      "set",
      "--json",
      "gateway.controlUi.allowedOrigins",
      JSON.stringify(allowedOrigins),
    ]);
    console.log(`[gateway] configured origins: ${allowedOrigins.join(", ")}`);
  } catch (err) {
    console.log(`[gateway] origin config warning: ${err.message}`);
  }

  // Remove lock files
  for (const lockPath of [
    path.join(STATE_DIR, "gateway.lock"),
    "/tmp/openclaw-gateway.lock",
  ]) {
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {}
  }

  const args = [
    "gateway",
    "run",
    "--bind",
    "loopback",
    "--port",
    String(INTERNAL_GATEWAY_PORT),
    "--auth",
    "token",
    "--token",
    OPENCLAW_GATEWAY_TOKEN,
    "--allow-unconfigured",
    "--no-device-pairing",  // Try to disable device pairing via flag
  ];

  gatewayProc = childProcess.spawn(OPENCLAW_CLI, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: STATE_DIR,
      OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
      OPENCLAW_SKIP_DEVICE_PAIRING: "true",  // Skip device pairing requirement
      OPENCLAW_AUTO_APPROVE_DEVICES: "true",  // Auto-approve device requests
    },
  });

  const safeArgs = args.map((arg, i) =>
    args[i - 1] === "--token" ? "[REDACTED]" : arg
  );
  console.log(`[gateway] starting: ${OPENCLAW_CLI} ${safeArgs.join(" ")}`);
  console.log(`[gateway] STATE_DIR: ${STATE_DIR}`);
  console.log(`[gateway] WORKSPACE_DIR: ${WORKSPACE_DIR}`);
  console.log(`[gateway] config: ${configPath()}`);

  gatewayProc.on("error", (err) => {
    console.error(`[gateway] spawn error: ${String(err)}`);
    gatewayProc = null;
  });

  gatewayProc.on("exit", (code, signal) => {
    console.error(`[gateway] exited code=${code} signal=${signal}`);
    gatewayProc = null;
    if (!shuttingDown && isConfigured()) {
      // Exponential backoff: 2s, 4s, 8s, 16s, 30s (max)
      restartAttempts++;
      const delay = Math.min(2000 * Math.pow(2, restartAttempts - 1), MAX_RESTART_DELAY);
      console.log(`[gateway] scheduling auto-restart in ${delay / 1000}s (attempt ${restartAttempts})...`);
      setTimeout(() => {
        if (!shuttingDown && !gatewayProc && isConfigured()) {
          ensureGatewayRunning().catch((err) => {
            console.error(`[gateway] auto-restart failed: ${err.message}`);
          });
        }
      }, delay);
    }
  });
}

async function ensureGatewayRunning() {
  if (gatewayProc) return;
  if (gatewayStarting) return gatewayStarting;
  
  gatewayStarting = (async () => {
    try {
      await startGateway();
      const isReady = await waitForGatewayReady();
      if (isReady) {
        // Reset restart attempts counter on successful start
        restartAttempts = 0;
        
        // Auto-approve any pending device pairing requests continuously
        const checkAndApproveDevices = async () => {
          try {
            console.log(`[gateway] Checking for pending devices...`);
            const result = await runCmd(OPENCLAW_CLI, ["devices", "list"]);
            const output = result.output || "";
            
            console.log(`[gateway] Devices list output (${output.length} chars): ${output.substring(0, 200)}`);
            
            if (!output.trim()) {
              console.log(`[gateway] No devices output yet`);
              return;
            }
            
            // Parse output for pending devices (same logic as /api/devices endpoint)
            const lines = output.split('\n');
            const pendingDevices = [];
            
            for (const line of lines) {
              if (!line.trim()) continue;
              console.log(`[gateway] Checking line: "${line}"`);
              const pendingMatch = line.match(/pending.*?([a-f0-9]{12,})/i);
              if (pendingMatch) {
                pendingDevices.push(pendingMatch[1]);
                console.log(`[gateway] Found pending device: ${pendingMatch[1]}`);
              }
            }
            
            console.log(`[gateway] Found ${pendingDevices.length} pending device(s)`);
            
            // Auto-approve each pending device
            for (const deviceId of pendingDevices) {
              console.log(`[gateway] 🔓 Auto-approving device: ${deviceId}`);
              try {
                const approveResult = await runCmd(OPENCLAW_CLI, ["devices", "approve", deviceId]);
                console.log(`[gateway] Approve result code: ${approveResult.code}, output: ${approveResult.output}`);
                if (approveResult.code === 0) {
                  console.log(`[gateway] ✅ Device ${deviceId} approved successfully`);
                } else {
                  console.warn(`[gateway] ⚠️  Device approval returned code ${approveResult.code}: ${approveResult.output}`);
                }
              } catch (approveErr) {
                console.error(`[gateway] ❌ Failed to approve device ${deviceId}: ${approveErr.message}`);
              }
            }
          } catch (err) {
            console.error(`[gateway] Error in checkAndApproveDevices: ${err.message}`);
          }
        };
        
        // Check immediately after 1 second and then every 3 seconds
        setTimeout(checkAndApproveDevices, 1000);
        setInterval(checkAndApproveDevices, 3000);
      }
    } finally {
      gatewayStarting = null;
    }
  })();
  
  return gatewayStarting;
}

function isGatewayStarting() {
  return gatewayStarting !== null;
}

function isGatewayReady() {
  return gatewayProc !== null && !isGatewayStarting();
}

async function restartGateway() {
  if (gatewayProc) {
    gatewayProc.kill("SIGTERM");
    await sleep(1000);
    if (gatewayProc && !gatewayProc.killed) {
      gatewayProc.kill("SIGKILL");
    }
    gatewayProc = null;
    await sleep(500);
  }
  await ensureGatewayRunning();
}

// Rate limiter for setup endpoints
const setupRateLimiter = {
  attempts: new Map(),
  windowMs: 60_000,
  maxAttempts: 50,
  cleanupInterval: setInterval(function () {
    const now = Date.now();
    for (const [ip, data] of setupRateLimiter.attempts) {
      if (now - data.windowStart > setupRateLimiter.windowMs) {
        setupRateLimiter.attempts.delete(ip);
      }
    }
  }, 60_000),

  isRateLimited(ip) {
    const now = Date.now();
    const record = setupRateLimiter.attempts.get(ip);
    if (!record || now - record.windowStart > setupRateLimiter.windowMs) {
      setupRateLimiter.attempts.set(ip, { windowStart: now, count: 1 });
      return false;
    }
    record.count++;
    return record.count > setupRateLimiter.maxAttempts;
  },
};

// Session store for setup authentication
const setupSessions = {
  sessions: new Map(),
  sessionDuration: 14400_000, // 4 hours (increased from 1 hour for better UX during setup)
  cleanupInterval: setInterval(function () {
    const now = Date.now();
    for (const [token, data] of setupSessions.sessions) {
      if (now > data.expiresAt) {
        setupSessions.sessions.delete(token);
      }
    }
  }, 300_000), // Clean up every 5 minutes

  create() {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.sessionDuration;
    this.sessions.set(token, { expiresAt });
    return token;
  },

  isValid(token) {
    if (!token) return false;
    const session = this.sessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  },

  delete(token) {
    this.sessions.delete(token);
  },
};

// Setup auth middleware
function requireSetupAuth(req, res, next) {
  if (!SETUP_PASSWORD) {
    return res
      .status(500)
      .type("text/plain")
      .send("SETUP_PASSWORD is not set. Set it in Railway Variables before using /setup.");
  }

  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  if (setupRateLimiter.isRateLimited(ip)) {
    return res.status(429).type("text/plain").send("Too many requests. Try again later.");
  }

  // Check session cookie
  const cookies = req.headers.cookie || '';
  const sessionMatch = cookies.match(/setup_session=([^;]+)/);
  const sessionToken = sessionMatch ? sessionMatch[1] : null;

  if (setupSessions.isValid(sessionToken)) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized', message: 'Please log in' });
}

// API key auth middleware for headless operations
function requireApiKey(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  
  if (!token) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Bearer token required. Set Authorization: Bearer <WRAPPER_API_KEY>' 
    });
  }
  
  // Accept either WRAPPER_API_KEY or OPENCLAW_GATEWAY_TOKEN for backward compat
  if (token !== WRAPPER_API_KEY && token !== OPENCLAW_GATEWAY_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
  }
  
  next();
}

// Express app
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Health endpoints
app.get("/healthz", async (_req, res) => {
  let gateway = "unconfigured";
  if (isConfigured()) {
    gateway = isGatewayReady() ? "ready" : "starting";
  }
  res.json({ ok: true, gateway });
});

app.get("/health", async (_req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.get("/setup/healthz", async (_req, res) => {
  const configured = isConfigured();
  const gatewayRunning = isGatewayReady();
  const starting = isGatewayStarting();
  let gatewayReachable = false;

  if (gatewayRunning) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const r = await fetch(`${GATEWAY_TARGET}/`, { signal: controller.signal });
      clearTimeout(timeout);
      gatewayReachable = r !== null;
    } catch {}
  }

  res.json({
    ok: true,
    wrapper: true,
    configured,
    gatewayRunning,
    gatewayStarting: starting,
    gatewayReachable,
  });
});

// Setup wizard routes
app.get("/setup", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "setup.html"));
});

app.post("/setup/api/login", async (req, res) => {
  if (!SETUP_PASSWORD) {
    return res.status(500).json({ ok: false, error: 'SETUP_PASSWORD not configured' });
  }

  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  if (setupRateLimiter.isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Try again later.' });
  }

  const { password } = req.body || {};
  
  if (!password) {
    return res.status(400).json({ ok: false, error: 'Password required' });
  }

  const passwordHash = crypto.createHash("sha256").update(password).digest();
  const expectedHash = crypto.createHash("sha256").update(SETUP_PASSWORD).digest();
  const isValid = crypto.timingSafeEqual(passwordHash, expectedHash);

  if (!isValid) {
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }

  // Create session
  const sessionToken = setupSessions.create();
  
  // Set secure cookie
  res.cookie('setup_session', sessionToken, {
    httpOnly: true,
    maxAge: setupSessions.sessionDuration,
    sameSite: 'lax',
  });

  return res.json({ ok: true });
});

app.post("/setup/api/logout", (_req, res) => {
  const cookies = req.headers.cookie || '';
  const sessionMatch = cookies.match(/setup_session=([^;]+)/);
  if (sessionMatch) {
    setupSessions.delete(sessionMatch[1]);
  }
  res.clearCookie('setup_session');
  return res.json({ ok: true });
});

app.get("/setup/api/check-auth", (req, res) => {
  const cookies = req.headers.cookie || '';
  const sessionMatch = cookies.match(/setup_session=([^;]+)/);
  const sessionToken = sessionMatch ? sessionMatch[1] : null;
  const authenticated = setupSessions.isValid(sessionToken);
  return res.json({ authenticated });
});

app.get("/setup/api/status", requireSetupAuth, async (_req, res) => {
  const { version, channelsHelp } = await getOpenclawInfo();

  const authGroups = [
    {
      value: "openai",
      label: "OpenAI",
      hint: "API key",
      options: [
        { value: "openai-api-key", label: "OpenAI API key" },
      ],
    },
    {
      value: "anthropic",
      label: "Anthropic",
      hint: "Claude API key",
      options: [
        { value: "apiKey", label: "Anthropic API key" },
      ],
    },
    {
      value: "google",
      label: "Google",
      hint: "Gemini API key",
      options: [
        { value: "gemini-api-key", label: "Google Gemini API key" },
      ],
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      hint: "API key",
      options: [{ value: "openrouter-api-key", label: "OpenRouter API key" }],
    },
  ];

  res.json({
    configured: isConfigured(),
    gatewayTarget: GATEWAY_TARGET,
    openclawVersion: version,
    channelsAddHelp: channelsHelp,
    authGroups,
    tuiEnabled: false,
    gateway: {
      running: isGatewayReady(),
      starting: isGatewayStarting(),
      pid: gatewayProc?.pid || null,
    },
  });
});

app.get("/setup/api/gateway/logs", requireSetupAuth, async (_req, res) => {
  // Get recent gateway logs
  const logPath = '/tmp/openclaw/openclaw-' + new Date().toISOString().split('T')[0] + '.log';
  try {
    const logResult = await runCmd('tail', ['-n', '100', logPath]);
    const logs = logResult.output || 'No logs found';
    
    // Parse for important status
    const hasTelegram = logs.includes('[telegram]');
    const telegramStarted = logs.includes('[telegram]') && logs.includes('starting provider');
    const hasErrors = logs.toLowerCase().includes('error') || logs.toLowerCase().includes('failed');
    
    res.json({
      ok: true,
      logs: logs,
      status: {
        hasTelegram,
        telegramStarted,
        hasErrors,
        logPath,
      }
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err),
      logPath,
    });
  }
});

// GET /setup/api/models - List available models (for setup wizard)
app.get("/setup/api/models", requireSetupAuth, async (req, res) => {
  try {
    // Support provider filter and --all flag
    const provider = req.query.provider;
    const args = ["models", "list", "--all"];
    if (provider) {
      args.push("--provider", provider);
    }
    const result = await runCmd(OPENCLAW_CLI, args);
    
    // Parse output to extract model info
    const lines = result.output.trim().split('\n');
    const models = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('=')) {
        // Try to parse format like: "provider/model-name (context-window)"
        const match = trimmed.match(/^([^\/]+)\/([^\s]+)(?:\s+\(([^)]+)\))?/);
        if (match) {
          models.push({
            provider: match[1],
            name: match[2],
            fullName: `${match[1]}/${match[2]}`,
            details: match[3] || null,
            raw: trimmed
          });
        } else {
          // Fallback: just store the raw line
          models.push({
            raw: trimmed
          });
        }
      }
    }
    
    res.json({
      ok: true,
      models,
      exitCode: result.code
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

function buildOnboardArgs(payload) {
  const args = [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--json",
    "--no-install-daemon",
    "--skip-health",
    "--workspace",
    WORKSPACE_DIR,
    "--gateway-bind",
    "loopback",
    "--gateway-port",
    String(INTERNAL_GATEWAY_PORT),
    "--gateway-auth",
    "token",
    "--gateway-token",
    OPENCLAW_GATEWAY_TOKEN,
    "--flow",
    payload.flow || "quickstart",
  ];

  if (payload.authChoice) {
    args.push("--auth-choice", payload.authChoice);

    const secret = (payload.authSecret || "").trim();
    const map = {
      "openai-api-key": "--openai-api-key",
      apiKey: "--anthropic-api-key",
      "openrouter-api-key": "--openrouter-api-key",
      "gemini-api-key": "--gemini-api-key",
    };
    const flag = map[payload.authChoice];
    if (flag && secret) {
      args.push(flag, secret);
    }
  }

  return args;
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      ...opts,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
      },
    });

    let out = "";
    proc.stdout?.on("data", (d) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (out += d.toString("utf8")));

    proc.on("error", (err) => {
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on("close", (code) => resolve({ code: code ?? 0, output: out }));
  });
}

const VALID_FLOWS = ["quickstart", "advanced", "manual"];
const VALID_AUTH_CHOICES = [
  "openai-api-key",
  "apiKey",
  "gemini-api-key",
  "openrouter-api-key",
];

// Cache for ClawHub API calls to avoid rate limits
const clawhubCache = {
  search: new Map(), // key: query, value: { data, timestamp }
  ttl: 86400000, // 24 hours cache
  
  get(type, key) {
    const cache = this[type];
    if (!cache) return null;
    
    const entry = cache.get(key);
    if (!entry) return null;
    
    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      cache.delete(key);
      return null;
    }
    
    return entry.data;
  },
  
  set(type, key, data) {
    const cache = this[type];
    if (!cache) return;
    
    cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Clean old entries (keep max 100 items)
    if (cache.size > 100) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
  }
};

function validatePayload(payload) {
  if (payload.flow && !VALID_FLOWS.includes(payload.flow)) {
    return `Invalid flow: ${payload.flow}. Must be one of: ${VALID_FLOWS.join(", ")}`;
  }
  if (payload.authChoice && !VALID_AUTH_CHOICES.includes(payload.authChoice)) {
    return `Invalid authChoice: ${payload.authChoice}`;
  }
  const stringFields = [
    "telegramToken",
    "discordToken",
    "authSecret",
    "model",
  ];
  for (const field of stringFields) {
    if (payload[field] !== undefined && typeof payload[field] !== "string") {
      return `Invalid ${field}: must be a string`;
    }
  }
  return null;
}

app.post("/setup/api/run", requireSetupAuth, async (req, res) => {  // Extend timeout for doctor operation
  req.setTimeout(300_000); // 5 minutes
  res.setTimeout(300_000);
    // Extend timeout for long-running onboard operation (default is often 30-120s)
  req.setTimeout(600_000); // 10 minutes
  res.setTimeout(600_000);
  
  try {
    if (isConfigured()) {
      await ensureGatewayRunning();
      return res.json({
        ok: true,
        output: "Already configured.\nUse Reset setup if you want to rerun onboarding.\n",
      });
    }

    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    const payload = req.body || {};
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ ok: false, output: validationError });
    }
    const onboardArgs = buildOnboardArgs(payload);
    const onboard = await runCmd(OPENCLAW_CLI, onboardArgs);

    let extra = "";
    extra += `\n[setup] Onboarding exit=${onboard.code} configured=${isConfigured()}\n`;

    const ok = onboard.code === 0 && isConfigured();

    if (ok) {
      extra += "\n[setup] Configuring gateway settings...\n";

      // Set gateway token in config
      const tokenResult = await runCmd(
        OPENCLAW_CLI,
        [
          "config",
          "set",
          "gateway.auth.token",
          OPENCLAW_GATEWAY_TOKEN,
        ],
      );
      extra += `[config] gateway.auth.token exit=${tokenResult.code}\n`;

      // Set allowInsecureAuth
      const allowInsecureResult = await runCmd(
        OPENCLAW_CLI,
        [
          "config",
          "set",
          "gateway.controlUi.allowInsecureAuth",
          "true",
        ],
      );
      extra += `[config] gateway.controlUi.allowInsecureAuth=true exit=${allowInsecureResult.code}\n`;

      // Set trusted proxies
      const proxiesResult = await runCmd(
        OPENCLAW_CLI,
        [
          "config",
          "set",
          "--json",
          "gateway.trustedProxies",
          '["127.0.0.1"]',
        ],
      );
      extra += `[config] gateway.trustedProxies exit=${proxiesResult.code}\n`;

      // Configure allowed origins for Railway deployment
      const allowedOrigins = ["http://localhost:8080", "http://127.0.0.1:8080"];
      
      // Add Railway public domain if available
      if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        allowedOrigins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
      }
      if (process.env.RAILWAY_STATIC_URL) {
        allowedOrigins.push(process.env.RAILWAY_STATIC_URL);
      }
      
      // Always allow wildcard for Railway subdomains (they use random subdomains during deployment)
      allowedOrigins.push("https://*.railway.app");
      
      const originsResult = await runCmd(
        OPENCLAW_CLI,
        [
          "config",
          "set",
          "--json",
          "gateway.controlUi.allowedOrigins",
          JSON.stringify(allowedOrigins),
        ],
      );
      extra += `[config] gateway.controlUi.allowedOrigins exit=${originsResult.code}\n`;

      // Set model if provided
      if (payload.model?.trim()) {
        extra += `[setup] Setting model to ${payload.model.trim()}...\n`;
        const modelResult = await runCmd(
          OPENCLAW_CLI,
          ["models", "set", payload.model.trim()],
        );
        extra += `[models set] exit=${modelResult.code}\n${modelResult.output || ""}`;
      }

      // Configure channels if tokens provided
      async function configureChannel(name, cfgObj) {
        const set = await runCmd(
          OPENCLAW_CLI,
          [
            "config",
            "set",
            "--json",
            `channels.${name}`,
            JSON.stringify(cfgObj),
          ],
        );
        return `\n[${name} config] exit=${set.code}\n${set.output || "(no output)"}`;
      }

      if (payload.telegramToken?.trim()) {
        extra += await configureChannel("telegram", {
          enabled: true,
          dmPolicy: "pairing",
          botToken: payload.telegramToken.trim(),
          groupPolicy: "allowlist",
          streamMode: "partial",
        });
      }

      if (payload.discordToken?.trim()) {
        extra += await configureChannel("discord", {
          enabled: true,
          token: payload.discordToken.trim(),
          groupPolicy: "allowlist",
          dm: { policy: "pairing" },
        });
      }

      extra += "\n[setup] Starting gateway...\n";
      await restartGateway();
      extra += "[setup] Gateway started.\n";
    }

    return res.status(ok ? 200 : 500).json({
      ok,
      output: `${onboard.output}${extra}`,
    });
  } catch (err) {
    console.error("[/setup/api/run] error:", err);
    return res
      .status(500)
      .json({ ok: false, output: `Internal error: ${String(err)}` });
  }
});

app.get("/setup/api/debug", requireSetupAuth, async (_req, res) => {
  const v = await runCmd(OPENCLAW_CLI, ["--version"]);
  res.json({
    wrapper: {
      node: process.version,
      port: PORT,
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR,
      configPath: configPath(),
      gatewayTokenFromEnv: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN?.trim()),
      gatewayTokenPersisted: fs.existsSync(path.join(STATE_DIR, "gateway.token")),
    },
    openclaw: {
      cli: OPENCLAW_CLI,
      version: v.output.trim(),
    },
  });
});

app.get("/setup/api/pairing/list", requireSetupAuth, async (req, res) => {
  // List all pending pairing requests
  req.setTimeout(60_000);
  res.setTimeout(60_000);
  
  const { channel } = req.query || {};
  const args = ["pairing", "list"];
  if (channel) {
    args.push(String(channel));
  }
  
  const r = await runCmd(OPENCLAW_CLI, args);
  return res
    .status(r.code === 0 ? 200 : 500)
    .json({ 
      ok: r.code === 0, 
      output: r.output,
      pending: r.output ? r.output.split('\n').filter(line => line.trim()).length : 0
    });
});

app.post("/setup/api/pairing/approve", requireSetupAuth, async (req, res) => {
  // Extend timeout for pairing operations
  req.setTimeout(120_000); // 2 minutes
  res.setTimeout(120_000);
  
  const { channel, code } = req.body || {};
  if (!channel || !code) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing channel or code" });
  }
  const r = await runCmd(
    OPENCLAW_CLI,
    ["pairing", "approve", String(channel), String(code)],
  );
  
  // Check if pairing succeeded even if exit code is non-zero
  // OpenClaw CLI sometimes returns non-zero but still succeeds
  const output = r.output || '';
  const successIndicators = [
    'approved',
    'success',
    'granted',
    'paired',
    'authorized'
  ];
  const errorIndicators = [
    'no pending',
    'not found',
    'invalid',
    'expired',
    'failed'
  ];
  
  const hasSuccess = successIndicators.some(word => 
    output.toLowerCase().includes(word)
  );
  const hasError = errorIndicators.some(word => 
    output.toLowerCase().includes(word)
  );
  
  // Consider it successful if:
  // - Exit code is 0, OR
  // - Output contains success indicators and no error indicators
  const isSuccess = r.code === 0 || (hasSuccess && !hasError);
  
  return res
    .status(isSuccess ? 200 : 500)
    .json({ 
      ok: isSuccess, 
      output: output,
      exitCode: r.code,
      debug: { hasSuccess, hasError }
    });
});

app.post("/setup/api/reset", requireSetupAuth, async (_req, res) => {
  try {
    fs.rmSync(configPath(), { force: true });
    res
      .type("text/plain")
      .send("OK - deleted config file. You can rerun setup now.");
  } catch (err) {
    res.status(500).type("text/plain").send(String(err));
  }
});

app.post("/setup/api/doctor", requireSetupAuth, async (_req, res) => {
  // Extend timeout for doctor operation
  _req.setTimeout(300_000); // 5 minutes
  res.setTimeout(300_000);
  
  const args = ["doctor", "--non-interactive", "--repair"];
  const result = await runCmd(OPENCLAW_CLI, args);
  return res.status(result.code === 0 ? 200 : 500).json({
    ok: result.code === 0,
    output: result.output,
  });
});

// ===== HEADLESS API ROUTES (Bearer token auth) =====

// GET /api/status - Gateway and configuration status
app.get("/api/status", requireApiKey, async (_req, res) => {
  try {
    const { version } = await getOpenclawInfo();
    const configured = isConfigured();
    const gatewayRunning = isGatewayReady();
    const starting = isGatewayStarting();
    let gatewayReachable = false;

    if (gatewayRunning) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const r = await fetch(`${GATEWAY_TARGET}/`, { 
          signal: controller.signal,
          headers: { Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}` }
        });
        clearTimeout(timeout);
        gatewayReachable = r !== null;
      } catch {}
    }

    res.json({
      ok: true,
      configured,
      openclawVersion: version,
      gateway: {
        running: gatewayRunning,
        starting,
        reachable: gatewayReachable,
        pid: gatewayProc?.pid || null,
        target: GATEWAY_TARGET,
        token: OPENCLAW_GATEWAY_TOKEN // Gateway token for WebSocket connections
      },
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /api/configure - Idempotent gateway configuration
app.post("/api/configure", requireApiKey, async (req, res) => {
  req.setTimeout(600_000); // 10 minutes
  res.setTimeout(600_000);
  
  try {
    if (isConfigured()) {
      // Already configured, just ensure gateway is running
      await ensureGatewayRunning();
      return res.json({
        ok: true,
        output: "Already configured. Gateway is running.\nUse POST /api/reset to reconfigure.\n",
        alreadyConfigured: true
      });
    }

    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    const payload = req.body || {};
    
    // Transform provider/apiKey to authChoice/authSecret for convenience
    if (payload.provider && !payload.authChoice) {
      const providerMap = {
        "openai": "openai-api-key",
        "anthropic": "apiKey",
        "google": "gemini-api-key",
        "gemini": "gemini-api-key",
        "openrouter": "openrouter-api-key",
      };
      payload.authChoice = providerMap[payload.provider.toLowerCase()];
    }
    if (payload.apiKey && !payload.authSecret) {
      payload.authSecret = payload.apiKey;
    }
    
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ ok: false, output: validationError });
    }

    const onboardArgs = buildOnboardArgs(payload);
    const onboard = await runCmd(OPENCLAW_CLI, onboardArgs);

    let extra = "";
    extra += `\n[api/configure] Onboarding exit=${onboard.code} configured=${isConfigured()}\n`;

    const ok = onboard.code === 0 && isConfigured();

    if (ok) {
      extra += "\n[api/configure] Configuring gateway settings...\n";

      // Set gateway token in config
      const tokenResult = await runCmd(
        OPENCLAW_CLI,
        ["config", "set", "gateway.auth.token", OPENCLAW_GATEWAY_TOKEN],
      );
      extra += `[config] gateway.auth.token exit=${tokenResult.code}\n`;

      // Set allowInsecureAuth
      const allowInsecureResult = await runCmd(
        OPENCLAW_CLI,
        ["config", "set", "gateway.controlUi.allowInsecureAuth", "true"],
      );
      extra += `[config] gateway.controlUi.allowInsecureAuth=true exit=${allowInsecureResult.code}\n`;

      // Set trusted proxies
      const proxiesResult = await runCmd(
        OPENCLAW_CLI,
        ["config", "set", "--json", "gateway.trustedProxies", '["127.0.0.1"]'],
      );
      extra += `[config] gateway.trustedProxies exit=${proxiesResult.code}\n`;

      // Configure allowed origins
      const allowedOrigins = ["http://localhost:8080", "http://127.0.0.1:8080"];
      if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        allowedOrigins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
      }
      if (process.env.RAILWAY_STATIC_URL) {
        allowedOrigins.push(process.env.RAILWAY_STATIC_URL);
      }
      allowedOrigins.push("https://*.railway.app");
      
      const originsResult = await runCmd(
        OPENCLAW_CLI,
        ["config", "set", "--json", "gateway.controlUi.allowedOrigins", JSON.stringify(allowedOrigins)],
      );
      extra += `[config] gateway.controlUi.allowedOrigins exit=${originsResult.code}\n`;

      // Set model if provided
      if (payload.model?.trim()) {
        // Determine provider prefix based on authChoice
        let providerPrefix = '';
        if (payload.authChoice === 'openai-api-key') {
          providerPrefix = 'openai/';
        } else if (payload.authChoice === 'apiKey') {
          providerPrefix = 'anthropic/';
        } else if (payload.authChoice === 'gemini-api-key') {
          providerPrefix = 'google/';
        } else if (payload.authChoice === 'openrouter-api-key') {
          providerPrefix = 'openrouter/';
        }
        
        const modelName = payload.model.trim();
        // Only add prefix if model doesn't already have one
        const fullModelName = modelName.includes('/') ? modelName : `${providerPrefix}${modelName}`;
        
        extra += `[api/configure] Setting model to ${fullModelName}...\n`;
        const modelResult = await runCmd(
          OPENCLAW_CLI,
          ["models", "set", fullModelName],
        );
        extra += `[models set] exit=${modelResult.code}\n${modelResult.output || ""}\n`;
      }

      // Configure channels if tokens provided
      async function configureChannel(name, cfgObj) {
        const set = await runCmd(
          OPENCLAW_CLI,
          ["config", "set", "--json", `channels.${name}`, JSON.stringify(cfgObj)],
        );
        return `\n[${name} config] exit=${set.code}\n${set.output || "(no output)"}\n`;
      }

      if (payload.telegramToken?.trim()) {
        extra += await configureChannel("telegram", {
          enabled: true,
          dmPolicy: "pairing",
          botToken: payload.telegramToken.trim(),
          groupPolicy: "allowlist",
          streamMode: "partial",
        });
      }

      if (payload.discordToken?.trim()) {
        extra += await configureChannel("discord", {
          enabled: true,
          token: payload.discordToken.trim(),
          groupPolicy: "allowlist",
          dm: { policy: "pairing" },
        });
      }

      extra += "\n[api/configure] Starting gateway...\n";
      await restartGateway();
      extra += "[api/configure] Gateway started.\n";
    }

    return res.status(ok ? 200 : 500).json({
      ok,
      output: `${onboard.output}${extra}`,
    });
  } catch (err) {
    console.error("[/api/configure] error:", err);
    return res.status(500).json({ ok: false, output: `Internal error: ${String(err)}` });
  }
});

// GET /api/logs - Get recent gateway logs
app.get("/api/logs", requireApiKey, async (req, res) => {
  const tail = parseInt(req.query.tail || '100', 10);
  const logPath = '/tmp/openclaw/openclaw-' + new Date().toISOString().split('T')[0] + '.log';
  
  try {
    const logResult = await runCmd('tail', ['-n', String(tail), logPath]);
    const logs = logResult.output || 'No logs found';
    
    // Parse for important status
    const hasTelegram = logs.includes('[telegram]');
    const hasDiscord = logs.includes('[discord]');
    const hasErrors = logs.toLowerCase().includes('error') || logs.toLowerCase().includes('failed');
    
    res.json({
      ok: true,
      logs: logs,
      logPath,
      status: {
        hasTelegram,
        hasDiscord,
        hasErrors,
      }
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err),
      logPath,
    });
  }
});

// POST /api/doctor - Run diagnostics and repairs
app.post("/api/doctor", requireApiKey, async (req, res) => {
  req.setTimeout(300_000); // 5 minutes
  res.setTimeout(300_000);
  
  const args = ["doctor", "--non-interactive", "--repair"];
  const result = await runCmd(OPENCLAW_CLI, args);
  return res.status(result.code === 0 ? 200 : 500).json({
    ok: result.code === 0,
    output: result.output,
    exitCode: result.code
  });
});

// GET /api/config/current - Get current configuration for easy reconfiguration
app.get("/api/config/current", requireApiKey, async (_req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(404).json({
        ok: false,
        error: "Not configured yet",
        hint: "Use POST /api/configure to set up the agent first"
      });
    }

    // Read current configuration values
    const configValues = {};
    const configKeys = [
      "aiProvider",
      "models.default",
      "channels.telegram",
      "channels.discord"
    ];

    for (const key of configKeys) {
      try {
        const result = await runCmd(OPENCLAW_CLI, ["config", "get", key]);
        if (result.code === 0 && result.output.trim()) {
          try {
            configValues[key] = JSON.parse(result.output);
          } catch {
            configValues[key] = result.output.trim();
          }
        }
      } catch {
        // Key doesn't exist, skip
      }
    }

    // Map to user-friendly format
    const provider = configValues.aiProvider;
    const model = configValues["models.default"];
    const telegram = configValues["channels.telegram"];
    const discord = configValues["channels.discord"];

    res.json({
      ok: true,
      config: {
        provider,
        model,
        telegram: telegram?.enabled ? {
          enabled: telegram.enabled,
          dmPolicy: telegram.dmPolicy,
          // Don't return the token for security
          hasToken: Boolean(telegram.botToken)
        } : null,
        discord: discord?.enabled ? {
          enabled: discord.enabled,
          // Don't return the token for security
          hasToken: Boolean(discord.token)
        } : null
      },
      hint: "Use this data to avoid re-entering API keys when reconfiguring. Note: tokens are not returned for security."
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /api/channels/update - Update channel configuration without full reconfigure
app.post("/api/channels/update", requireApiKey, async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(400).json({
        ok: false,
        error: "Agent not configured yet",
        hint: "Use POST /api/configure first to set up the agent"
      });
    }

    const { telegram, discord } = req.body || {};
    let output = "";
    let restartNeeded = false;

    // Update Telegram config if provided
    if (telegram) {
      restartNeeded = true;
      const telegramConfig = {
        enabled: telegram.enabled !== false,
        dmPolicy: telegram.dmPolicy || "pairing",
        botToken: telegram.token,
        groupPolicy: telegram.groupPolicy || "allowlist",
        streamMode: telegram.streamMode || "partial"
      };
      
      const result = await runCmd(
        OPENCLAW_CLI,
        ["config", "set", "--json", "channels.telegram", JSON.stringify(telegramConfig)]
      );
      output += `Telegram config updated (exit=${result.code})\n${result.output || ""}\n`;
    }

    // Update Discord config if provided
    if (discord) {
      restartNeeded = true;
      const discordConfig = {
        enabled: discord.enabled !== false,
        token: discord.token,
        groupPolicy: discord.groupPolicy || "allowlist",
        dm: { policy: discord.dmPolicy || "pairing" }
      };
      
      const result = await runCmd(
        OPENCLAW_CLI,
        ["config", "set", "--json", "channels.discord", JSON.stringify(discordConfig)]
      );
      output += `Discord config updated (exit=${result.code})\n${result.output || ""}\n`;
    }

    if (!telegram && !discord) {
      return res.status(400).json({
        ok: false,
        error: "No channel updates provided",
        hint: "Include 'telegram' or 'discord' in request body"
      });
    }

    // Restart gateway to apply changes
    if (restartNeeded) {
      output += "\nRestarting gateway...\n";
      await restartGateway();
      output += "Gateway restarted successfully\n";
    }

    res.json({
      ok: true,
      output,
      message: "Channel configuration updated successfully"
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /api/reset - Delete configuration and stop gateway
app.post("/api/reset", requireApiKey, async (req, res) => {
  try {
    // Read current config before deleting (for user convenience)
    let currentConfig = null;
    if (isConfigured()) {
      try {
        const configValues = {};
        const configKeys = ["aiProvider", "models.default"];
        
        for (const key of configKeys) {
          try {
            const result = await runCmd(OPENCLAW_CLI, ["config", "get", key]);
            if (result.code === 0 && result.output.trim()) {
              try {
                configValues[key] = JSON.parse(result.output);
              } catch {
                configValues[key] = result.output.trim();
              }
            }
          } catch {
            // Key doesn't exist, skip
          }
        }
        
        currentConfig = {
          provider: configValues.aiProvider,
          model: configValues["models.default"],
          hint: "Save these values to avoid re-entering them during reconfiguration. You'll still need to provide your API key again."
        };
      } catch {
        // Ignore errors reading config
      }
    }
    
    // Stop gateway first
    if (gatewayProc) {
      gatewayProc.kill("SIGTERM");
      await sleep(1000);
      if (gatewayProc && !gatewayProc.killed) {
        gatewayProc.kill("SIGKILL");
      }
      gatewayProc = null;
    }
    
    // Delete config
    fs.rmSync(configPath(), { force: true });
    
    res.json({
      ok: true,
      message: "Configuration deleted. Gateway stopped. Use POST /api/configure to set up again.",
      previousConfig: currentConfig
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /api/pairing - List pending pairing requests
app.get("/api/pairing", requireApiKey, async (req, res) => {
  req.setTimeout(60_000);
  res.setTimeout(60_000);
  
  const { channel } = req.query || {};
  
  // If channel is specified, list for that channel only
  if (channel) {
    const args = ["pairing", "list", "--channel", String(channel)];
    const r = await runCmd(OPENCLAW_CLI, args);
    
    // Parse output into structured format
    const pending = [];
    if (r.code === 0 && r.output) {
      const lines = r.output.split('\n').filter(line => line.trim());
      for (const line of lines) {
        // Skip "No pending" messages
        if (line.toLowerCase().includes('no pending')) continue;
        
        // Match actual pairing codes (alphanumeric, not "pending" or "No")
        const match = line.match(/^([a-zA-Z0-9]{4,})\s+(telegram|discord)/i);
        if (match && match[1].toLowerCase() !== 'pending' && match[1].toLowerCase() !== 'no') {
          pending.push({
            code: match[1],
            channel: match[2].toLowerCase(),
            info: line.trim()
          });
        }
      }
    }
    
    return res.status(r.code === 0 ? 200 : 500).json({ 
      ok: r.code === 0, 
      output: r.output,
      pending,
      count: pending.length
    });
  }
  
  // No channel specified - try both telegram and discord
  const pending = [];
  const channels = ['telegram', 'discord'];
  const outputs = [];
  
  for (const ch of channels) {
    const args = ["pairing", "list", "--channel", ch];
    const r = await runCmd(OPENCLAW_CLI, args);
    
    if (r.code === 0 && r.output) {
      outputs.push(r.output);
      const lines = r.output.split('\n').filter(line => line.trim());
      for (const line of lines) {
        // Skip "No pending" messages
        if (line.toLowerCase().includes('no pending')) continue;
        
        // Match actual pairing codes (alphanumeric, not "pending" or "No")
        const match = line.match(/^([a-zA-Z0-9]{4,})\s+(telegram|discord)/i);
        if (match && match[1].toLowerCase() !== 'pending' && match[1].toLowerCase() !== 'no') {
          pending.push({
            code: match[1],
            channel: match[2].toLowerCase(),
            info: line.trim()
          });
        }
      }
    }
  }
  
  return res.json({ 
    ok: true, 
    output: outputs.join('\n'),
    pending,
    count: pending.length
  });
});

// POST /api/pairing/approve - Approve a pairing request
app.post("/api/pairing/approve", requireApiKey, async (req, res) => {
  req.setTimeout(120_000); // 2 minutes
  res.setTimeout(120_000);
  
  const { channel, code } = req.body || {};
  if (!channel || !code) {
    return res.status(400).json({ ok: false, error: "Missing channel or code" });
  }
  
  const r = await runCmd(
    OPENCLAW_CLI,
    ["pairing", "approve", String(channel), String(code)],
  );
  
  // Check if pairing succeeded
  const output = r.output || '';
  const successIndicators = ['approved', 'success', 'granted', 'paired', 'authorized'];
  const errorIndicators = ['no pending', 'not found', 'invalid', 'expired', 'failed'];
  
  const hasSuccess = successIndicators.some(word => output.toLowerCase().includes(word));
  const hasError = errorIndicators.some(word => output.toLowerCase().includes(word));
  const isSuccess = r.code === 0 || (hasSuccess && !hasError);
  
  return res.status(isSuccess ? 200 : 500).json({ 
    ok: isSuccess, 
    output: output,
    exitCode: r.code
  });
});

// Device management API (backward compatible, now secured)
app.get("/api/devices", requireApiKey, async (_req, res) => {
  try {
    const result = await runCmd(OPENCLAW_CLI, ["devices", "list"]);
    const devices = [];
    const lines = result.output.trim().split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      const pendingMatch = line.match(/pending.*?([a-f0-9]{12,})/i);
      if (pendingMatch) {
        devices.push({
          requestId: pendingMatch[1],
          status: 'pending',
          info: line.trim(),
        });
      }
    }
    
    res.json({ success: true, devices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, devices: [] });
  }
});

app.post("/api/devices/approve", requireApiKey, async (req, res) => {
  try {
    const { requestId } = req.body;
    if (!requestId) {
      return res.status(400).json({ success: false, error: "Missing requestId" });
    }
    
    const result = await runCmd(OPENCLAW_CLI, ["devices", "approve", requestId]);
    res.json({ 
      success: result.code === 0, 
      message: `Device ${requestId} approved`,
      output: result.output 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/devices/status - Check device pairing status for this instance
app.get("/api/devices/status", requireApiKey, async (_req, res) => {
  try {
    res.json({
      ok: true,
      devicePairingEnabled: false,
      pairingRequired: false,
      stateDir: STATE_DIR,
      message: "Device pairing is disabled for API-based usage. Skills can be used without device approval.",
      help: {
        message: "Device pairing is disabled. All operations work without device approval.",
        note: "Device pairing is only needed for Telegram/Discord channel access, not for API usage."
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ===== SKILL MANAGEMENT API ROUTES =====

// GET /api/skills - List installed skills
app.get("/api/skills", requireApiKey, async (_req, res) => {
  try {
    const skillsDir = path.join(WORKSPACE_DIR, 'skills');
    const skills = [];
    
    // Try reading from filesystem directly (most reliable)
    try {
      if (fs.existsSync(skillsDir)) {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillPath = path.join(skillsDir, entry.name);
            let version = 'unknown';
            
            // Try to read version from package.json or SKILL.md
            try {
              const pkgPath = path.join(skillPath, 'package.json');
              if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                version = pkg.version || 'unknown';
              }
            } catch (err) {
              // Ignore version read errors
            }
            
            skills.push({
              slug: entry.name,
              version,
              path: skillPath
            });
          }
        }
      }
    } catch (fsError) {
      console.warn('[api/skills] Filesystem read failed:', fsError.message);
    }
    
    // If no skills found via filesystem, try clawhub list as fallback
    if (skills.length === 0) {
      try {
        const CLAWHUB_CLI = process.env.CLAWHUB_CLI?.trim() || "clawhub";
        const result = await runCmd(CLAWHUB_CLI, ["list", "--workdir", WORKSPACE_DIR]);
        
        const lines = result.output.trim().split('\n');
        
        for (const line of lines) {
          if (!line.trim() || line.startsWith('#')) continue;
          
          // Skip common "no skills" messages
          if (line.toLowerCase().includes('no installed skills') || 
              line.toLowerCase().includes('no skills found')) {
            continue;
          }
          
          // Parse format: skill-slug@1.0.0 or similar
          const match = line.match(/^([a-z0-9\-]+)@?([0-9.]*)/i);
          if (match && match[1]) {
            skills.push({
              slug: match[1],
              version: match[2] || 'unknown',
              raw: line.trim()
            });
          }
        }
      } catch (cmdError) {
        console.warn('[api/skills] clawhub list failed:', cmdError.message);
      }
    }
    
    res.json({
      ok: true,
      skills,
      count: skills.length,
      workspaceDir: WORKSPACE_DIR,
      skillsDir
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message, 
      skills: [] 
    });
  }
});

// GET /api/skills/search - Search ClawHub for skills
app.get("/api/skills/search", requireApiKey, async (req, res) => {
  try {
    const { q, limit } = req.query;
    if (!q) {
      return res.status(400).json({ ok: false, error: 'Missing query parameter: q' });
    }
    
    const query = String(q).trim();
    const maxResults = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    const cacheKey = `${query}:${maxResults}`;
    
    // Check cache first to avoid rate limits
    const cached = clawhubCache.get('search', cacheKey);
    if (cached) {
      return res.json({
        ok: true,
        query,
        results: cached,
        count: cached.length,
        cached: true
      });
    }
    
    // Use ClawHub API directly
    const clawhubApiUrl = `https://clawhub.ai/api/v1/search?q=${encodeURIComponent(query)}&limit=${maxResults}`;
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const response = await fetch(clawhubApiUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'openclaw-agent-wrapper/1.0'
        }
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`ClawHub API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Parse response - format may vary
      let results = [];
      if (Array.isArray(data)) {
        results = data.map(item => ({
          slug: item.package || item.slug || item.id || item.name,
          name: item.name || item.title || (item.package || item.slug || item.id),
          description: item.description || item.summary || '',
          author: item.author || item.creator || item.owner,
          version: item.version || item.latest_version || item.latestVersion,
          tags: item.tags || [],
          package: item.package || item.slug,
          score: item.score || item.relevance
        }));
      } else if (data.results && Array.isArray(data.results)) {
        results = data.results.map(item => ({
          slug: item.package || item.slug || item.id || item.name,
          name: item.name || item.title || (item.package || item.slug || item.id),
          description: item.description || item.summary || '',
          author: item.author || item.creator || item.owner,
          version: item.version || item.latest_version || item.latestVersion,
          tags: item.tags || [],
          package: item.package || item.slug,
          score: item.score || item.relevance
        }));
      } else if (data.skills && Array.isArray(data.skills)) {
        results = data.skills.map(item => ({
          slug: item.package || item.slug || item.id || item.name,
          name: item.name || item.title || (item.package || item.slug || item.id),
          description: item.description || item.summary || '',
          author: item.author || item.creator || item.owner,
          version: item.version || item.latest_version || item.latestVersion,
          tags: item.tags || [],
          package: item.package || item.slug,
          score: item.score || item.relevance
        }));
      }
      
      // Log raw data for debugging (first result only)
      if (results.length > 0 && data.results?.[0]) {
        console.log('[skills/search] Sample raw item:', JSON.stringify(data.results[0], null, 2));
      }
      
      // Cache the results
      clawhubCache.set('search', cacheKey, results);
      
      res.json({
        ok: true,
        query,
        results,
        count: results.length
      });
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        return res.status(504).json({
          ok: false,
          error: 'ClawHub API timeout',
          results: []
        });
      }
      
      console.error('[skills/search] ClawHub API error:', fetchError);
      
      // Fallback to CLI if API fails
      const CLAWHUB_CLI = process.env.CLAWHUB_CLI?.trim() || "clawhub";
      const args = ["search", query, "--no-input"];
      if (limit) {
        args.push("--limit", String(maxResults));
      }
      
      const result = await runCmd(CLAWHUB_CLI, args);
      
      if (result.code !== 0) {
        return res.status(500).json({
          ok: false,
          error: `ClawHub search failed: ${fetchError.message}`,
          results: []
        });
      }
      
      // Parse CLI output
      const results = [];
      const lines = result.output.trim().split('\n');
      
      for (const line of lines) {
        if (!line.trim() || line.startsWith('Searching') || line.startsWith('Found')) continue;
        
        const match = line.match(/^([a-z0-9\-]+)\s*-\s*(.+)$/i);
        if (match) {
          results.push({
            slug: match[1],
            description: match[2].trim()
          });
        } else if (line.match(/^[a-z0-9\-]+$/i)) {
          results.push({
            slug: line.trim(),
            description: ''
          });
        }
      }
      
      // Cache CLI results too
      clawhubCache.set('search', cacheKey, results);
      
      res.json({
        ok: true,
        query,
        results,
        count: results.length,
        source: 'cli'
      });
    }
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message, 
      results: [] 
    });
  }
});

// POST /api/skills/install - Install a skill
app.post("/api/skills/install", requireApiKey, async (req, res) => {
  try {
    const { slug, version, force, retry } = req.body || {};
    
    if (!slug) {
      return res.status(400).json({ ok: false, error: 'Missing required field: slug' });
    }
    
    const CLAWHUB_CLI = process.env.CLAWHUB_CLI?.trim() || "clawhub";
    const args = ["install", String(slug), "--workdir", WORKSPACE_DIR, "--no-input"];
    
    if (version) {
      args.push("--version", String(version));
    }
    if (force) {
      args.push("--force");
    }
    
    // Retry logic for rate limit errors
    const maxRetries = retry === true ? 3 : (typeof retry === 'number' ? retry : 0);
    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Wait 2 minutes between retries to respect ClawHub rate limits
        const delay = 120000; // 2 minutes
        console.log(`[api/skills/install] Rate limited, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries + 1})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      const result = await runCmd(CLAWHUB_CLI, args);
      const output = result.output || '';
      const isRateLimit = output.toLowerCase().includes('rate limit');
      const success = result.code === 0 || output.toLowerCase().includes('installed');
      
      if (success) {
        return res.json({
          ok: true,
          slug,
          version: version || 'latest',
          output: result.output,
          exitCode: result.code,
          attempts: attempt + 1
        });
      }
      
      lastError = result;
      
      // If not rate limit error, don't retry
      if (!isRateLimit) {
        break;
      }
    }
    
    // All retries failed or non-rate-limit error
    const isRateLimit = (lastError.output || '').toLowerCase().includes('rate limit');
    
    res.status(isRateLimit ? 429 : 500).json({
      ok: false,
      slug,
      version: version || 'latest',
      output: lastError.output,
      exitCode: lastError.code,
      error: isRateLimit ? 'Rate limit exceeded' : 'Installation failed',
      suggestion: isRateLimit ? 'Wait 2 minutes and retry, or use {"retry": true} in request body for automatic retries (waits 2 minutes between attempts)' : undefined
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// POST /api/skills/update - Update skill(s)
app.post("/api/skills/update", requireApiKey, async (req, res) => {
  try {
    const { slug, all, version, force } = req.body || {};
    
    if (!slug && !all) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Must specify either slug or all=true' 
      });
    }
    
    const CLAWHUB_CLI = process.env.CLAWHUB_CLI?.trim() || "clawhub";
    const args = ["update", "--workdir", WORKSPACE_DIR, "--no-input"];
    
    if (all) {
      args.push("--all");
    } else {
      args.push(String(slug));
      if (version) {
        args.push("--version", String(version));
      }
    }
    
    if (force) {
      args.push("--force");
    }
    
    const result = await runCmd(CLAWHUB_CLI, args);
    const success = result.code === 0 || result.output.toLowerCase().includes('updated');
    
    res.json({
      ok: success,
      slug: slug || 'all',
      output: result.output,
      exitCode: result.code
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// DELETE /api/skills/:slug - Delete a skill
app.delete("/api/skills/:slug", requireApiKey, async (req, res) => {
  try {
    const { slug } = req.params;
    
    if (!slug) {
      return res.status(400).json({ ok: false, error: 'Missing skill slug' });
    }
    
    // Remove the skill directory
    const skillPath = path.join(WORKSPACE_DIR, 'skills', slug);
    
    if (!fs.existsSync(skillPath)) {
      return res.status(404).json({ 
        ok: false, 
        error: `Skill not found: ${slug}`,
        path: skillPath
      });
    }
    
    fs.rmSync(skillPath, { recursive: true, force: true });
    
    res.json({
      ok: true,
      slug,
      message: `Skill ${slug} deleted`,
      path: skillPath
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// POST /api/admin/restart - Restart the Gateway process
app.post("/api/admin/restart", requireApiKey, async (req, res) => {
  try {
    console.log("[api/admin/restart] Restarting Gateway to load new skills...");
    
    // Send response immediately before restart
    res.json({
      ok: true,
      message: "Gateway restart initiated. Skills will be reloaded.",
      hint: "Gateway should be ready in 5-10 seconds. Use GET /health to check status."
    });
    
    // Restart in background after response is sent
    setImmediate(async () => {
      try {
        await restartGateway();
        console.log("[api/admin/restart] Gateway restarted successfully");
      } catch (err) {
        console.error("[api/admin/restart] Error restarting Gateway:", err);
      }
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ===== CHAT/MESSAGING API ROUTE =====

// Singleton gateway client instance (reuses WebSocket connection)
let gatewayClient = null;

function getGatewayClient() {
  if (!gatewayClient) {
    const gatewayUrl = `ws://${INTERNAL_GATEWAY_HOST}:${INTERNAL_GATEWAY_PORT}/gateway?token=${OPENCLAW_GATEWAY_TOKEN}`;
    gatewayClient = new OpenClawGatewayClient({
      gatewayUrl,
      token: OPENCLAW_GATEWAY_TOKEN,
      stateDir: STATE_DIR
    });
  }
  return gatewayClient;
}

// POST /api/chat - Send message to agent and get response
app.post("/api/chat", requireApiKey, async (req, res) => {
  try {
    const { message, agentId = "main", sessionKey } = req.body || {};
    
    if (!message) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required field: message' 
      });
    }
    
    // Ensure gateway is running
    if (!isGatewayReady()) {
      await ensureGatewayRunning();
      if (!isGatewayReady()) {
        return res.status(503).json({
          ok: false,
          error: 'Gateway not ready'
        });
      }
    }
    
    // Set request timeout
    req.setTimeout(120000); // 2 minutes
    res.setTimeout(120000);
    
    try {
      const client = getGatewayClient();
      
      // Generate session key if not provided (per-user sessions)
      const finalSessionKey = sessionKey || `api-session-${Date.now()}`;
      
      const response = await client.sendChat({
        agentId,
        sessionKey: finalSessionKey,
        text: message
      });
      
      res.json({
        ok: true,
        agentId,
        sessionKey: finalSessionKey,
        response,
        timestamp: new Date().toISOString()
      });
    } catch (chatError) {
      // If connection failed, reset client and try once more
      if (chatError.message.includes('timeout') || chatError.message.includes('closed')) {
        gatewayClient = null; // Reset for next request
        return res.status(504).json({
          ok: false,
          error: 'Gateway timeout or connection closed',
          message: chatError.message
        });
      }
      throw chatError;
    }
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// ===== OpenClaw CLI INFO ENDPOINTS =====

// GET /api/channels - Get channels status (Telegram, Discord, etc.)
app.get("/api/channels", requireApiKey, async (_req, res) => {
  try {
    const result = await runCmd(OPENCLAW_CLI, ["channels", "status"]);
    
    // Parse output to extract channel info
    const lines = result.output.trim().split('\n');
    const channels = [];
    
    for (const line of lines) {
      // Parse lines like: "telegram: connected (@botname)"
      // or "discord: disconnected"
      const match = line.match(/^(\w+):\s+(\w+)(?:\s+\(([^)]+)\))?/);
      if (match) {
        channels.push({
          type: match[1],
          status: match[2],
          info: match[3] || null
        });
      }
    }
    
    res.json({
      ok: true,
      output: result.output,
      channels,
      exitCode: result.code
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// GET /api/models - List available models
app.get("/api/models", requireApiKey, async (req, res) => {
  try {
    // Support provider filter and --all flag
    const provider = req.query.provider;
    const args = ["models", "list", "--all"];
    if (provider) {
      args.push("--provider", provider);
    }
    const result = await runCmd(OPENCLAW_CLI, args);
    
    // Parse output to extract model info
    const lines = result.output.trim().split('\n');
    const models = [];
    
    for (const line of lines) {
      // Parse lines with model information
      // Format may vary, so we'll capture the raw line and try to extract fields
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('=')) {
        // Try to parse format like: "provider/model-name (context-window)"
        const match = trimmed.match(/^([^\/]+)\/([^\s]+)(?:\s+\(([^)]+)\))?/);
        if (match) {
          models.push({
            provider: match[1],
            name: match[2],
            details: match[3] || null,
            raw: trimmed
          });
        } else {
          // Fallback: just store the raw line
          models.push({
            raw: trimmed
          });
        }
      }
    }
    
    res.json({
      ok: true,
      output: result.output,
      models,
      exitCode: result.code
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// GET /api/config - Get OpenClaw configuration
app.get("/api/config", requireApiKey, async (req, res) => {
  try {
    // Get specific config path or all config
    const configPath = req.query.path;
    
    if (!configPath) {
      // Path is required by this version of OpenClaw CLI
      return res.status(400).json({ 
        ok: false, 
        error: "Missing required query parameter: path",
        hint: "Use /api/config?path=gateway.port or similar"
      });
    }
    
    // Call: openclaw config get <path>
    const result = await runCmd(OPENCLAW_CLI, ["config", "get", configPath]);
    
    // Try to parse as JSON if possible
    let config = null;
    try {
      config = JSON.parse(result.output);
    } catch {
      // Return the raw value for specific paths
      config = result.output.trim();
    }
    
    res.json({
      ok: result.code === 0,
      output: result.output,
      config,
      path: configPath,
      exitCode: result.code
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// GET /api/sessions - List active sessions
app.get("/api/sessions", requireApiKey, async (_req, res) => {
  try {
    const result = await runCmd(OPENCLAW_CLI, ["sessions"]);
    
    // Parse output to extract session info
    const lines = result.output.trim().split('\n');
    const sessions = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('=') && !trimmed.startsWith('error:')) {
        // Try to parse session information
        // Format may vary, store what we can extract
        const parts = trimmed.split(/\s+/);
        if (parts.length > 0) {
          sessions.push({
            id: parts[0],
            raw: trimmed
          });
        }
      }
    }
    
    res.json({
      ok: true,
      output: result.output,
      sessions,
      count: sessions.length,
      exitCode: result.code
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// Proxy setup
const proxy = httpProxy.createProxyServer({
  target: GATEWAY_TARGET,
  ws: true,
  xfwd: true,
  proxyTimeout: 120_000,
  timeout: 120_000,
});

proxy.on("error", (err, _req, res) => {
  console.error("[proxy]", err);
  if (res && typeof res.headersSent !== "undefined" && !res.headersSent) {
    res.writeHead(503, { "Content-Type": "text/html" });
    try {
      const html = fs.readFileSync(
        path.join(__dirname, "public", "loading.html"),
        "utf8",
      );
      res.end(html);
    } catch {
      res.end("Gateway unavailable. Retrying...");
    }
  }
});

// Auto-inject bearer token
proxy.on("proxyReq", (proxyReq, req, res) => {
  proxyReq.setHeader("Authorization", `Bearer ${OPENCLAW_GATEWAY_TOKEN}`);
});

proxy.on("proxyReqWs", (proxyReq, req, socket, options, head) => {
  proxyReq.setHeader("Authorization", `Bearer ${OPENCLAW_GATEWAY_TOKEN}`);
});

// Main request handler
app.use(async (req, res) => {
  if (!isConfigured() && !req.path.startsWith("/setup")) {
    return res.redirect("/setup");
  }

  if (isConfigured()) {
    if (!isGatewayReady()) {
      try {
        await ensureGatewayRunning();
      } catch {
        return res
          .status(503)
          .sendFile(path.join(__dirname, "public", "loading.html"));
      }

      if (!isGatewayReady()) {
        return res
          .status(503)
          .sendFile(path.join(__dirname, "public", "loading.html"));
      }
    }
  }

  if (req.path === "/openclaw" && !req.query.token) {
    return res.redirect(`/openclaw?token=${OPENCLAW_GATEWAY_TOKEN}`);
  }

  return proxy.web(req, res, { target: GATEWAY_TARGET });
});

const server = app.listen(PORT, () => {
  console.log(`[wrapper] listening on port ${PORT}`);
  console.log(`[wrapper] setup wizard: http://localhost:${PORT}/setup`);
  console.log(`[wrapper] configured: ${isConfigured()}`);
  console.log(`[wrapper] gateway token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 12)}...`);

  if (isConfigured()) {
    (async () => {
      try {
        console.log("[wrapper] running openclaw doctor --fix...");
        const dr = await runCmd(OPENCLAW_CLI, ["doctor", "--fix"]);
        console.log(`[wrapper] doctor --fix exit=${dr.code}`);
        if (dr.output) console.log(dr.output);
      } catch (err) {
        console.warn(`[wrapper] doctor --fix failed: ${err.message}`);
      }
      await ensureGatewayRunning();
    })().catch((err) => {
      console.error(`[wrapper] failed to start gateway at boot: ${err.message}`);
    });
  }
});

// Set server-wide timeout to 10 minutes (default is often 120s or 30s depending on Node version)
// Individual endpoints can override this with req/res.setTimeout()
server.timeout = 600_000;
server.keepAliveTimeout = 605_000; // Slightly higher than timeout

// WebSocket upgrade handler
server.on("upgrade", async (req, socket, head) => {
  if (!isConfigured()) {
    socket.destroy();
    return;
  }
  try {
    await ensureGatewayRunning();
  } catch (err) {
    console.warn(`[websocket] gateway not ready: ${err.message}`);
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head, { target: GATEWAY_TARGET });
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`[wrapper] received ${signal}, shutting down`);
  shuttingDown = true;

  if (setupRateLimiter.cleanupInterval) {
    clearInterval(setupRateLimiter.cleanupInterval);
  }

  server.close();

  if (gatewayProc) {
    try {
      gatewayProc.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => gatewayProc.on("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      if (gatewayProc && !gatewayProc.killed) {
        gatewayProc.kill("SIGKILL");
      }
    } catch (err) {
      console.warn(`[wrapper] error killing gateway: ${err.message}`);
    }
  }

  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
