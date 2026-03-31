import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import httpProxy from "http-proxy";
import { WebSocketServer } from "ws";

import { OpenClawGatewayClient } from "./gatewayClient.js";
import { initializeWallet } from "./wallet.js";
import { notifyCronJob, isNotificationConfigured } from "./notification-helper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const STATE_DIR = process.env.OPENCLAW_STATE_DIR?.trim() || "/data/.openclaw";
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR?.trim() || "/data/workspace";
const SETUP_PASSWORD = process.env.SETUP_PASSWORD?.trim();

// Auto-configure OpenAI defaults for all agents
// Set DEFAULT_OPENAI_API_KEY in Railway environment variables
const DEFAULT_OPENAI_KEY = process.env.DEFAULT_OPENAI_API_KEY?.trim();
const DEFAULT_MODEL = process.env.DEFAULT_MODEL?.trim() || "gpt-4o-mini";

// Set OpenAI API key in environment if not already set
if (!process.env.OPENAI_API_KEY && DEFAULT_OPENAI_KEY) {
  process.env.OPENAI_API_KEY = DEFAULT_OPENAI_KEY;
  console.log("[autoconfigure] Set default OPENAI_API_KEY from DEFAULT_OPENAI_API_KEY env var");
}
if (DEFAULT_OPENAI_KEY) {
  console.log("[autoconfigure] Default model: " + DEFAULT_MODEL);
} else {
  console.log("[autoconfigure] No DEFAULT_OPENAI_API_KEY set - OpenAI credentials must be provided during setup");
}

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
const SKILLS_CACHE = "/opt/skills-cache/skills";

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

  // Note: We handle auto-approval in the wrapper's checkAndApproveDevices loop
  // Don't enable gateway's built-in autoApprove to avoid race conditions
  try {
    await runCmd(OPENCLAW_CLI, [
      "config",
      "set",
      "gateway.devices.autoApprove",
      "false",
    ]);
    console.log("[gateway] gateway built-in auto-approve disabled (wrapper handles it)");
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
            
            // Parse output for pending devices - ONLY from Pending section
            const lines = output.split('\n');
            const pendingRequestIds = [];
            let inPendingSection = false;
            
            for (const line of lines) {
              if (!line.trim()) continue;
              
              // Detect Pending section start
              if (line.includes('Pending (')) {
                inPendingSection = true;
                continue;
              }
              
              // Detect section end (next table header or "Paired" section)
              if (inPendingSection && (line.includes('Paired (') || line.match(/^[└┴]/))) {
                inPendingSection = false;
                break;
              }
              
              // Only extract UUIDs from Pending section
              if (inPendingSection) {
                const uuidMatch = line.match(/│\s*([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\s*│/i);
                if (uuidMatch) {
                  const requestId = uuidMatch[1];
                  console.log(`[gateway] Found pending request: ${requestId}`);
                  pendingRequestIds.push(requestId);
                }
              }
            }
            
            console.log(`[gateway] Found ${pendingRequestIds.length} pending request(s)`);
            
            // Auto-approve each pending device request with operator role and scopes
            for (const requestId of pendingRequestIds) {
              console.log(`[gateway] 🔓 Auto-approving request: ${requestId}`);
              try {
                // Try with role and scopes first
                let approveResult = await runCmd(OPENCLAW_CLI, [
                  "devices", "approve", requestId,
                  "--role", "operator",
                  "--scopes", "operator.read,operator.write,operator.admin"
                ]);
                
                // If flags not supported, try simple approve
                if (approveResult.code !== 0 && approveResult.output?.includes('unknown option')) {
                  console.log(`[gateway] Role/scope flags not supported, trying simple approve...`);
                  approveResult = await runCmd(OPENCLAW_CLI, ["devices", "approve", requestId]);
                }
                
                console.log(`[gateway] Approve result code: ${approveResult.code}`);
                if (approveResult.code === 0) {
                  console.log(`[gateway] ✅ Request ${requestId} approved with operator role`);
                } else {
                  // Only log warnings for real errors, not "unknown requestId" (already processed)
                  const isAlreadyProcessed = approveResult.output?.includes('unknown requestId');
                  if (isAlreadyProcessed) {
                    console.log(`[gateway] ℹ️  Request ${requestId} was already processed`);
                  } else {
                    console.warn(`[gateway] ⚠️  Approval returned code ${approveResult.code}: ${approveResult.output}`);
                  }
                }
              } catch (approveErr) {
                console.error(`[gateway] ❌ Failed to approve request ${requestId}: ${approveErr.message}`);
              }
            }
          } catch (err) {
            console.error(`[gateway] Error in checkAndApproveDevices: ${err.message}`);
          }
        };
        
        // Check for devices missing correct scopes and revoke them
        const revokeIncorrectDevices = async () => {
          try {
            console.log(`[gateway] Checking for devices with incorrect scopes...`);
            const result = await runCmd(OPENCLAW_CLI, ["devices", "list"]);
            const output = result.output || "";
            
            if (!output.includes('Paired')) {
              console.log(`[gateway] No paired devices found`);
              return;
            }
            
            // Parse table looking for devices in "Paired" section
            const lines = output.split('\n');
            let inPairedSection = false;
            
            for (const line of lines) {
              if (line.includes('Paired (')) {
                inPairedSection = true;
                continue;
              }
              if (inPairedSection && line.includes('├─') || line.includes('└─')) {
                break;  // End of paired section
              }
              
              if (inPairedSection && line.includes('│')) {
                // Extract device ID (first column after │)
                const deviceMatch = line.match(/│\s*([a-f0-9]{20,})\s*│/i);
                if (!deviceMatch) continue;
                
                const deviceId = deviceMatch[1];
                // Check if line contains operator.write scope
                if (!line.includes('operator.write')) {
                  console.log(`[gateway] 🗑️  Revoking device ${deviceId} (missing operator.write scope)`);
                  try {
                    await runCmd(OPENCLAW_CLI, ["devices", "revoke", deviceId]);
                    console.log(`[gateway] ✅ Device ${deviceId} revoked, will re-pair with correct scopes`);
                  } catch (revokeErr) {
                    console.error(`[gateway] ❌ Failed to revoke ${deviceId}: ${revokeErr.message}`);
                  }
                }
              }
            }
          } catch (err) {
            console.error(`[gateway] Error checking device scopes: ${err.message}`);
          }
        };
        
        // Revoke devices with incorrect scopes, then start auto-approval loop
        setTimeout(async () => {
          await revokeIncorrectDevices();
          checkAndApproveDevices();  // Check immediately after revoke
          setInterval(checkAndApproveDevices, 5000);  // Then every 5 seconds
        }, 1000);
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

// Copy cached skills from Docker image to workspace on startup
async function copyCachedSkillsToWorkspace() {
  try {
    // Check if cache directory exists
    if (!fs.existsSync(SKILLS_CACHE)) {
      console.log("[skills] no skill cache found at", SKILLS_CACHE);
      return { copied: 0, skipped: 0, errors: 0 };
    }

    const targetDir = path.join(WORKSPACE_DIR, 'skills');
    fs.mkdirSync(targetDir, { recursive: true });

    const cachedSkills = fs.readdirSync(SKILLS_CACHE, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name);

    let copied = 0;
    let skipped = 0;
    let errors = 0;

    for (const skillName of cachedSkills) {
      const targetPath = path.join(targetDir, skillName);
      
      // Skip if already exists in workspace (user may have modified it)
      if (fs.existsSync(targetPath)) {
        skipped++;
        continue;
      }

      try {
        const sourcePath = path.join(SKILLS_CACHE, skillName);
        
        // Copy skill directory recursively
        fs.cpSync(sourcePath, targetPath, { recursive: true });
        copied++;
        console.log(`[skills] installed from cache: ${skillName}`);
      } catch (err) {
        console.error(`[skills] failed to copy ${skillName}: ${err.message}`);
        errors++;
      }
    }

    return { copied, skipped, errors, total: cachedSkills.length };
  } catch (err) {
    console.error(`[skills] cache copy failed: ${err.message}`);
    return { copied: 0, skipped: 0, errors: 1 };
  }
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

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Allow all Railway domains
    if (origin.includes('.railway.app')) return callback(null, true);
    
    // Allow localhost for development
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return callback(null, true);
    }
    
    // Allow configured domains
    if (process.env.RAILWAY_PUBLIC_DOMAIN && origin.includes(process.env.RAILWAY_PUBLIC_DOMAIN)) {
      return callback(null, true);
    }
    
    // Allow any other origin (you can restrict this further if needed)
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
};

app.use(cors(corsOptions));
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

// OpenClaw Cron Webhook Endpoint
// This receives finished events from OpenClaw cron jobs configured with delivery.mode = "webhook"
app.post("/api/openclaw-cron-webhook", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const payload = req.body;
    
    console.log('[cron-webhook] Received payload:', JSON.stringify(payload, null, 2));
    console.log('[cron-webhook] Payload keys:', Object.keys(payload || {}));
    console.log('[cron-webhook] Payload type:', typeof payload, 'Type field:', payload?.type);
    
    if (!payload) {
      console.warn('[cron-webhook] No payload received');
      return res.status(400).json({ 
        ok: false, 
        error: 'No payload',
        message: 'Request body is empty' 
      });
    }

    // Handle different webhook payload formats
    let job, run, eventType;
    
    // Format 0: Agent-posted full content (NEW - primary format)
    // Agents POST their full results directly with this structure
    if (payload.content && (payload.jobName || payload.status)) {
      job = {
        id: payload.jobId || 'agent-posted',
        name: payload.jobName || 'Cron Job',
        schedule: payload.schedule
      };
      run = {
        status: payload.status || 'completed',
        summary: null, // No summary needed - we have full content
        output: payload.content, // Full content from agent
        result: payload.content,
        response: payload.content,
        startedAt: payload.startedAt || payload.timestamp,
        endedAt: payload.endedAt || new Date().toISOString(),
        duration: payload.duration || 0
      };
      eventType = 'agent-posted';
      console.log('[cron-webhook] ✅ Received agent-posted full content');
    }
    // Format 1: Standard cron.finished event (OLD - deprecated)
    else if (payload.type === 'cron.finished') {
      job = payload.job;
      run = payload.run;
      eventType = 'cron.finished';
      console.log('[cron-webhook] ⚠️ Received old cron.finished event (only has summary)');
    }
    // Format 2: Direct job/run structure (OLD - deprecated)
    else if (payload.job && payload.run) {
      job = payload.job;
      run = payload.run;
      eventType = 'cron-event';
      console.log('[cron-webhook] ⚠️ Received old cron-event format (only has summary)');
    }
    // Format 3: Flat structure with job details at top level
    else if (payload.jobId || payload.id) {
      job = {
        id: payload.jobId || payload.id,
        name: payload.jobName || payload.name || 'Cron Job',
        schedule: payload.schedule
      };
      run = {
        status: payload.status || 'completed',
        summary: payload.summary || payload.message || 'Job completed',
        output: payload.output || payload.result || payload.response,
        error: payload.error,
        startedAt: payload.startedAt,
        endedAt: payload.endedAt,
        duration: payload.duration
      };
      eventType = 'flat-format';
    }
    // Format 4: OpenClaw gateway event format
    else if (payload.kind === 'cron' || payload.event === 'cron') {
      // Gateway sends "kind" or "event" field
      job = {
        id: payload.jobId || 'unknown',
        name: payload.jobName || payload.name || 'Cron Job',
        schedule: payload.schedule
      };
      run = {
        status: payload.status || payload.state || 'completed',
        summary: payload.text || payload.message || 'Job completed',
        output: payload.output || payload.result || payload.response,
        error: payload.error,
        startedAt: payload.startedAt || payload.timestamp,
        endedAt: payload.endedAt || new Date().toISOString(),
        duration: payload.duration || 0
      };
      eventType = 'gateway-format';
    }
    else {
      console.error('[cron-webhook] Unknown payload format. Payload:', JSON.stringify(payload, null, 2));
      // Accept it anyway and try to extract what we can
      job = {
        id: 'unknown',
        name: payload.name || payload.title || 'Cron Job',
      };
      run = {
        status: 'completed',
        summary: payload.message || payload.text || JSON.stringify(payload).substring(0, 100),
        output: payload.output || payload.result || payload.response || payload.data
      };
      eventType = 'unknown-format';
    }

    console.log('[cron-webhook] Parsed format:', eventType);
    console.log('[cron-webhook] Job:', JSON.stringify(job, null, 2));
    console.log('[cron-webhook] Run:', JSON.stringify(run, null, 2));

    // Extract cron job details
    const jobName = job?.name || 'Unnamed Cron Job';
    const status = run?.status || 'completed';
    
    // Try to get the full output first (may contain complete data from skills)
    // then fall back to summary if output not available
    let fullOutput = run?.output || run?.result || run?.response || run?.text;
    const summary = run?.summary || run?.error || 'Completed';
    
    // Only try to fetch from CLI if using old event format (not agent-posted)
    // If we only have a summary and there's a runId, try to fetch full run details
    const runId = run?.runId || run?.id;
    if (eventType !== 'agent-posted' && !fullOutput && runId) {
      console.log(`[cron-webhook] ⚠️ Old format detected - attempting to fetch full run details for runId: ${runId}`);
      try {
        const result = await runCmd(OPENCLAW_CLI, ["cron", "runs", "--id", job?.id || job?.jobId, "--limit", "1", "--json"]);
        if (result.code === 0) {
          const runs = JSON.parse(result.output);
          const latestRun = Array.isArray(runs) ? runs[0] : runs;
          
          if (latestRun) {
            console.log('[cron-webhook] Latest run data keys:', Object.keys(latestRun));
            
            // Extract full output from run data
            fullOutput = latestRun.output || 
                        latestRun.result || 
                        latestRun.response || 
                        latestRun.text ||
                        latestRun.content;
            
            if (fullOutput) {
              console.log(`[cron-webhook] ✅ Retrieved full output (${fullOutput.length} chars)`);
            }
          }
        }
      } catch (err) {
        console.warn('[cron-webhook] Failed to fetch full run details:', err.message);
        // Fall back to summary
      }
    }
    
    // Use full output if available, otherwise use summary
    const content = fullOutput || summary;
    
    console.log('[cron-webhook] Content type:', fullOutput ? 'full output' : 'summary only');
    console.log('[cron-webhook] Content length:', content?.length || 0);
    
    // Build notification message
    let message = content;
    if (status === 'success' || status === 'completed' || status === 'ok') {
      message = `✅ ${content}`;
    } else if (status === 'error' || status === 'failed') {
      message = `❌ ${content}`;
    } else if (status === 'skipped') {
      message = `⏭️ ${content}`;
    }

    // Extract Telegram chat ID if present in payload/job/run metadata
    const telegramChatId = resolveTelegramChatId(payload, job, run);
    if (telegramChatId) {
      console.log('[cron-webhook] Resolved telegramChatId:', telegramChatId);
    }

    const notificationData = {
      jobId: job?.id || job?.jobId,
      status: run?.status,
      startedAt: run?.startedAt,
      endedAt: run?.endedAt,
      duration: run?.duration,
      schedule: job?.schedule?.kind,
      sessionTarget: job?.sessionTarget,
      telegramChatId: telegramChatId || undefined,
      eventType, // Include for debugging
      rawPayload: payload // Include raw payload for debugging
    };

    console.log(`[cron-webhook] Forwarding notification: ${jobName} [${status}]`);

    // Send to launcher webhook (frontend notification)
    const notificationSent = await notifyCronJob(jobName, message, notificationData);

    if (notificationSent) {
      console.log(`[cron-webhook] ✅ Successfully forwarded cron job: ${jobName} [${status}]`);
    } else {
      console.error(`[cron-webhook] ❌ Failed to forward notification for: ${jobName}`);
    }

    // If the cron job was created from a Telegram conversation, also deliver directly to Telegram
    let telegramSent = false;
    if (telegramChatId) {
      console.log(`[cron-webhook] Telegram delivery requested for chat ${telegramChatId}`);
      const telegramResult = await sendTelegramMessage(telegramChatId, message);
      telegramSent = telegramResult.ok;
      if (!telegramSent) {
        console.error(`[cron-webhook] ❌ Telegram delivery failed for chat ${telegramChatId}:`, telegramResult.error);
      }
    }
    
    res.json({ ok: true, received: true, notificationSent, telegramSent, eventType });
    
  } catch (error) {
    console.error('[cron-webhook] Error processing cron event:', error);
    console.error('[cron-webhook] Error stack:', error.stack);
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to process cron event',
      message: error.message 
    });
  }
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

  // Default to OpenAI if no auth choice specified
  const authChoice = payload.authChoice || "openai-api-key";
  args.push("--auth-choice", authChoice);

  const secret = (payload.authSecret || "").trim();
  const map = {
    "openai-api-key": "--openai-api-key",
    apiKey: "--anthropic-api-key",
    "openrouter-api-key": "--openrouter-api-key",
    "gemini-api-key": "--gemini-api-key",
  };
  const flag = map[authChoice];
  if (flag) {
    // Use provided secret, or fallback to default OpenAI key if auth is openai
    const secretValue = secret || (authChoice === "openai-api-key" ? DEFAULT_OPENAI_KEY : "");
    if (secretValue) {
      args.push(flag, secretValue);
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

      // Set model (use provided model or default to gpt-4o-mini)
      const modelToSet = payload.model?.trim() || DEFAULT_MODEL;
      
      // Add provider prefix based on authChoice (which defaults to openai-api-key in buildOnboardArgs)
      const authChoice = payload.authChoice || "openai-api-key";
      let providerPrefix = '';
      if (authChoice === 'openai-api-key') {
        providerPrefix = 'openai/';
      } else if (authChoice === 'apiKey') {
        providerPrefix = 'anthropic/';
      } else if (authChoice === 'gemini-api-key') {
        providerPrefix = 'google/';
      } else if (authChoice === 'openrouter-api-key') {
        providerPrefix = 'openrouter/';
      }
      
      // Only add prefix if model doesn't already have one
      const fullModelName = modelToSet.includes('/') ? modelToSet : `${providerPrefix}${modelToSet}`;
      
      extra += `[setup] Setting model to ${fullModelName}...\n`;
      const modelResult = await runCmd(
        OPENCLAW_CLI,
        ["models", "set", fullModelName],
      );
      extra += `[models set] exit=${modelResult.code}\n${modelResult.output || ""}`;

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

// GET /api/notifications/status - Check notification configuration status
app.get("/api/notifications/status", requireApiKey, async (_req, res) => {
  try {
    const configured = isNotificationConfigured();
    const { count, limit, remaining, windowRemaining } = await import('./notification-helper.js')
      .then(m => m.getRateLimitStatus());
    
    res.json({
      ok: true,
      configured,
      webhook: {
        url: process.env.LAUNCHER_WEBHOOK_URL ? '[configured]' : null,
        tokenSet: !!process.env.LAUNCHER_AGENT_TOKEN
      },
      rateLimit: {
        count,
        limit,
        remaining,
        windowRemainingMs: windowRemaining
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /api/cron/jobs - List all cron jobs
app.get("/api/cron/jobs", requireApiKey, async (req, res) => {
  try {
    console.log('[cron-jobs] Listing cron jobs...');
    
    // List all cron jobs
    const result = await runCmd(OPENCLAW_CLI, ["cron", "list", "--json"]);
    if (result.code !== 0) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to list cron jobs',
        details: result.error
      });
    }
    
    // Parse and normalize the output
    let jobs = [];
    try {
      const parsed = JSON.parse(result.output);
      console.log('[cron-jobs] Parsed output type:', typeof parsed, 'Is array:', Array.isArray(parsed));
      
      // Handle different response formats
      if (Array.isArray(parsed)) {
        jobs = parsed;
      } else if (parsed && typeof parsed === 'object') {
        // Check if it's wrapped in an object with a 'jobs' or 'items' key
        if (Array.isArray(parsed.jobs)) {
          jobs = parsed.jobs;
        } else if (Array.isArray(parsed.items)) {
          jobs = parsed.items;
        } else if (Array.isArray(parsed.data)) {
          jobs = parsed.data;
        } else if (Object.keys(parsed).length > 0) {
          // If it's a single job object, wrap it in an array
          jobs = [parsed];
        }
      }
    } catch (parseErr) {
      console.error('[cron-jobs] Failed to parse JSON:', parseErr.message);
      console.error('[cron-jobs] Raw output:', result.output);
      return res.status(500).json({
        ok: false,
        error: 'Failed to parse cron list output',
        details: parseErr.message,
        rawOutput: result.output.substring(0, 500)
      });
    }
    
    const webhookUrl = getAgentWebhookUrl(req);
    
    // Add webhook status to each job
    const jobsWithStatus = jobs.map(job => ({
      ...job,
      webhookConfigured: job.delivery?.mode === 'webhook' && job.delivery?.to === webhookUrl
    }));
    
    res.json({
      ok: true,
      jobs: jobsWithStatus,
      count: jobsWithStatus.length,
      webhookUrl
    });
  } catch (err) {
    console.error('[cron-jobs] Unexpected error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /api/cron/webhook-url - Get the webhook URL for cron job configuration
app.get("/api/cron/webhook-url", requireApiKey, async (req, res) => {
  try {
    // Determine the agent's public URL
    const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN || 
                        process.env.RAILWAY_STATIC_URL ||
                        req.get('host');
    
    const protocol = publicDomain?.includes('localhost') ? 'http' : 'https';
    const webhookUrl = `${protocol}://${publicDomain}/api/openclaw-cron-webhook`;
    
    res.json({
      ok: true,
      webhookUrl,
      instructions: "Use this URL when creating OpenClaw cron jobs to enable frontend notifications",
      example: `openclaw cron add --name "My Job" --cron "0 * * * *" --message "Do something" --webhook --webhook-url "${webhookUrl}"`
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /api/cron/audit-webhooks - Audit and fix all cron jobs to ensure they have webhook delivery
app.post("/api/cron/audit-webhooks", requireApiKey, async (req, res) => {
  try {
    console.log('[audit-webhooks] Starting cron webhook audit...');
    
    // List all cron jobs
    const result = await runCmd(OPENCLAW_CLI, ["cron", "list", "--json"]);
    if (result.code !== 0) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to list cron jobs',
        details: result.error
      });
    }
    
    const webhookUrl = getAgentWebhookUrl(req);
    
    // Parse and normalize the output
    let jobs = [];
    try {
      const parsed = JSON.parse(result.output);
      console.log('[audit-webhooks] Parsed output type:', typeof parsed, 'Is array:', Array.isArray(parsed));
      console.log('[audit-webhooks] Parsed output:', JSON.stringify(parsed, null, 2));
      
      // Handle different response formats
      if (Array.isArray(parsed)) {
        jobs = parsed;
      } else if (parsed && typeof parsed === 'object') {
        // Check if it's wrapped in an object with a 'jobs' or 'items' key
        if (Array.isArray(parsed.jobs)) {
          jobs = parsed.jobs;
        } else if (Array.isArray(parsed.items)) {
          jobs = parsed.items;
        } else if (Array.isArray(parsed.data)) {
          jobs = parsed.data;
        } else {
          // If it's a single job object, wrap it in an array
          jobs = [parsed];
        }
      }
    } catch (parseErr) {
      console.error('[audit-webhooks] Failed to parse JSON:', parseErr.message);
      console.error('[audit-webhooks] Raw output:', result.output);
      return res.status(500).json({
        ok: false,
        error: 'Failed to parse cron list output',
        details: parseErr.message,
        rawOutput: result.output.substring(0, 500)
      });
    }
    
    const summary = {
      total: jobs.length,
      alreadyConfigured: 0,
      fixed: 0,
      failed: 0,
      details: []
    };
    
    if (jobs.length === 0) {
      console.log('[audit-webhooks] No cron jobs found');
      return res.json({
        ok: true,
        summary,
        webhookUrl,
        message: 'No cron jobs found'
      });
    }
    
    for (const job of jobs) {
      const hasWebhook = job.delivery?.mode === 'webhook';
      const correctUrl = job.delivery?.to === webhookUrl;
      
      if (hasWebhook && correctUrl) {
        summary.alreadyConfigured++;
        summary.details.push({
          id: job.id,
          name: job.name,
          status: 'ok',
          message: 'Already configured with webhook'
        });
      } else {
        console.log(`[audit-webhooks] Fixing: ${job.name} (${job.id})`);
        
        const updateResult = await runCmd(OPENCLAW_CLI, [
          "cron", "update", job.id,
          "--webhook",
          "--webhook-url", webhookUrl
        ]);
        
        if (updateResult.code === 0) {
          console.log(`[audit-webhooks] ✅ Fixed: ${job.name}`);
          summary.fixed++;
          summary.details.push({
            id: job.id,
            name: job.name,
            status: 'fixed',
            message: 'Added webhook delivery'
          });
        } else {
          console.error(`[audit-webhooks] ❌ Failed: ${job.name}`, updateResult.error);
          summary.failed++;
          summary.details.push({
            id: job.id,
            name: job.name,
            status: 'failed',
            message: updateResult.error || 'Update failed'
          });
        }
      }
    }
    
    console.log(`[audit-webhooks] Complete: ${summary.fixed} fixed, ${summary.failed} failed, ${summary.alreadyConfigured} already ok`);
    
    res.json({
      ok: true,
      summary,
      webhookUrl
    });
  } catch (err) {
    console.error('[audit-webhooks] Unexpected error:', err);
    res.status(500).json({ ok: false, error: String(err), stack: err.stack });
  }
});

// POST /api/notifications/test - Send a test cron notification
app.post("/api/notifications/test", requireApiKey, async (req, res) => {
  try {
    if (!isNotificationConfigured()) {
      return res.status(400).json({
        ok: false,
        error: 'Notifications not configured',
        message: 'Set LAUNCHER_WEBHOOK_URL and LAUNCHER_AGENT_TOKEN environment variables'
      });
    }

    const { title = 'Test Cron Notification', message = 'This is a test cron notification from OpenClaw Agent' } = req.body || {};
    
    // Send test cron notification
    const data = { source: 'test-endpoint', timestamp: new Date().toISOString() };
    const success = await notifyCronJob(title, message, data);

    if (success) {
      res.json({
        ok: true,
        message: 'Test notification sent successfully',
        type: 'cron',
        title,
        sent: true
      });
    } else {
      res.status(500).json({
        ok: false,
        error: 'Failed to send notification',
        message: 'Check server logs for details'
      });
    }
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

      // Set model (use provided model or default to gpt-4o-mini)
      const modelToSet = payload.model?.trim() || DEFAULT_MODEL;
      
      // Determine provider prefix based on authChoice (defaults to openai-api-key like buildOnboardArgs)
      const authChoice = payload.authChoice || "openai-api-key";
      let providerPrefix = '';
      if (authChoice === 'openai-api-key') {
        providerPrefix = 'openai/';
      } else if (authChoice === 'apiKey') {
        providerPrefix = 'anthropic/';
      } else if (authChoice === 'gemini-api-key') {
        providerPrefix = 'google/';
      } else if (authChoice === 'openrouter-api-key') {
        providerPrefix = 'openrouter/';
      }
      
      // Only add prefix if model doesn't already have one
      const fullModelName = modelToSet.includes('/') ? modelToSet : `${providerPrefix}${modelToSet}`;
      
      extra += `[api/configure] Setting model to ${fullModelName}...\n`;
      const modelResult = await runCmd(
        OPENCLAW_CLI,
        ["models", "set", fullModelName],
      );
      extra += `[models set] exit=${modelResult.code}\n${modelResult.output || ""}\n`;

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
      // Extract UUID request IDs from table rows: │ <uuid> │
      const uuidMatch = line.match(/│\s*([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\s*│/i);
      if (uuidMatch) {
        devices.push({
          requestId: uuidMatch[1],
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
    const { requestId, role, scopes } = req.body;
    if (!requestId) {
      return res.status(400).json({ success: false, error: "Missing requestId" });
    }
    
    // Build approve command with optional role and scopes
    const approveArgs = ["devices", "approve", requestId];
    if (role) {
      approveArgs.push("--role", role);
    }
    if (scopes) {
      const scopesStr = Array.isArray(scopes) ? scopes.join(',') : scopes;
      approveArgs.push("--scopes", scopesStr);
    }
    
    const result = await runCmd(OPENCLAW_CLI, approveArgs);
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

// GET /api/skills/cache - List pre-built cached skills (no ClawHub request)
app.get("/api/skills/cache", requireApiKey, async (_req, res) => {
  try {
    // ClawHub installs to <workdir>/skills/, so check there
    const cached = [];
    const debug = {};
    
    // Debug info
    debug.skillsCachePath = SKILLS_CACHE;
    debug.skillsCacheExists = fs.existsSync(SKILLS_CACHE);
    
    // Check parent directory
    const parentDir = path.dirname(SKILLS_CACHE);
    debug.parentDir = parentDir;
    debug.parentDirExists = fs.existsSync(parentDir);
    if (debug.parentDirExists) {
      try {
        debug.parentDirContents = fs.readdirSync(parentDir).join(', ');
      } catch (err) {
        debug.parentDirError = err.message;
      }
    }
    
    if (fs.existsSync(SKILLS_CACHE)) {
      const entries = fs.readdirSync(SKILLS_CACHE, { withFileTypes: true });
      debug.cacheEntries = entries.map(e => `${e.name} (${e.isDirectory() ? 'dir' : 'file'})`).join(', ');
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          cached.push({
            slug: entry.name,
            path: path.join(SKILLS_CACHE, entry.name),
            source: 'pre-built'
          });
        }
      }
    }
    
    res.json({
      ok: true,
      cached,
      count: cached.length,
      message: cached.length > 0 
        ? `${cached.length} skill(s) available in cache (instant install, no rate limits)` 
        : 'No cached skills available',
      debug
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// GET /api/skills/:slug/files - List files in a skill directory
app.get("/api/skills/:slug/files", requireApiKey, async (req, res) => {
  try {
    const { slug } = req.params;
    const skillPath = path.join(WORKSPACE_DIR, 'skills', slug);
    
    if (!fs.existsSync(skillPath)) {
      return res.status(404).json({ 
        ok: false, 
        error: `Skill '${slug}' not found` 
      });
    }
    
    const files = fs.readdirSync(skillPath, { withFileTypes: true })
      .map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        path: path.join(skillPath, entry.name)
      }));
    
    res.json({
      ok: true,
      slug,
      path: skillPath,
      files
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// GET /api/skills/:slug/files/:filename - Read a specific file from a skill
app.get("/api/skills/:slug/files/:filename", requireApiKey, async (req, res) => {
  try {
    const { slug, filename } = req.params;
    const skillPath = path.join(WORKSPACE_DIR, 'skills', slug);
    const filePath = path.join(skillPath, filename);
    
    // Security: ensure the file is within the skill directory
    const normalizedSkillPath = path.normalize(skillPath);
    const normalizedFilePath = path.normalize(filePath);
    if (!normalizedFilePath.startsWith(normalizedSkillPath)) {
      return res.status(403).json({ 
        ok: false, 
        error: 'Access denied: path traversal not allowed' 
      });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        ok: false, 
        error: `File '${filename}' not found in skill '${slug}'` 
      });
    }
    
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return res.status(400).json({ 
        ok: false, 
        error: `'${filename}' is not a file` 
      });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    res.json({
      ok: true,
      slug,
      filename,
      path: filePath,
      size: stats.size,
      content
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
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
    
    // Check if skill exists in pre-built cache (avoids ClawHub rate limits)
    // ClawHub installs to <workdir>/skills/, so check there
    const cachedSkillPath = path.join(SKILLS_CACHE, slug);
    
    if (fs.existsSync(cachedSkillPath) && !force) {
      console.log(`[api/skills/install] Using cached skill: ${slug}`);
      
      // Copy from cache to workspace/skills directory
      const skillsDir = path.join(WORKSPACE_DIR, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });
      const targetPath = path.join(skillsDir, slug);
      try {
        // Use cp command for reliable copying
        const copyResult = await runCmd("cp", ["-r", cachedSkillPath, targetPath]);
        
        if (copyResult.code === 0) {
          return res.json({
            ok: true,
            slug,
            version: version || 'cached',
            output: `Installed ${slug} from pre-built cache (no ClawHub request needed)`,
            exitCode: 0,
            source: 'cache',
            attempts: 1
          });
        } else {
          console.warn(`[api/skills/install] Cache copy failed, falling back to ClawHub`);
        }
      } catch (cacheErr) {
        console.warn(`[api/skills/install] Cache error: ${cacheErr.message}, falling back to ClawHub`);
      }
    }
    
    // Fall back to ClawHub if not in cache or copy failed
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
          source: 'clawhub',
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

// ===== CRYPTO WALLET API ROUTES =====

// GET /api/wallet - Get wallet info (public address, chains supported)
app.get("/api/wallet", requireApiKey, async (_req, res) => {
  try {
    if (!agentWallet) {
      return res.status(503).json({
        ok: false,
        error: 'Wallet not initialized yet. Wait for agent startup to complete.',
        initialized: false
      });
    }
    
    const info = agentWallet.getInfo();
    res.json({
      ok: true,
      ...info,
      funded: false, // Placeholder - would need to check balance on-chain
      note: "Fund this address with ETH/MATIC/etc to enable crypto trading and on-chain operations"
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// POST /api/wallet/sign - Sign a message with agent's wallet
app.post("/api/wallet/sign", requireApiKey, async (req, res) => {
  try {
    const { message } = req.body || {};
    
    if (!message) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required field: message' 
      });
    }
    
    if (!agentWallet) {
      return res.status(503).json({
        ok: false,
        error: 'Wallet not initialized'
      });
    }
    
    const signature = await agentWallet.signMessage(message);
    
    res.json({
      ok: true,
      message,
      signature,
      address: agentWallet.wallet.address
    });
  } catch (error) {
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// GET /api/wallet/export - Export private key (use with caution!)
app.get("/api/wallet/export", requireApiKey, async (req, res) => {
  try {
    // Additional security: require explicit confirmation param
    const { confirm } = req.query;
    
    if (confirm !== 'yes') {
      return res.status(400).json({
        ok: false,
        error: 'This endpoint exports your private key. Add ?confirm=yes to proceed.',
        warning: '⚠️  Never share your private key. Anyone with it can control your funds.'
      });
    }
    
    if (!agentWallet) {
      return res.status(503).json({
        ok: false,
        error: 'Wallet not initialized'
      });
    }
    
    const privateKey = agentWallet.getPrivateKey();
    
    res.json({
      ok: true,
      address: agentWallet.wallet.address,
      privateKey,
      warning: '⚠️  KEEP THIS PRIVATE! Save to Railway env var: AGENT_WALLET_PRIVATE_KEY',
      instructions: 'Add this to Railway Variables to persist wallet across deployments'
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
    const { message, agentId = "main", sessionKey, telegramChatId } = req.body || {};
    
    if (!message) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required field: message' 
      });
    }
    
    // Sanitize telegramChatId to only allow numeric Telegram chat IDs (positive or negative integers)
    const safeTelegramChatId = parseTelegramChatId(telegramChatId);
    
    if (telegramChatId && !safeTelegramChatId) {
      console.warn('[api/chat] Ignoring invalid telegramChatId:', telegramChatId);
    }

    // If chat ID not provided, attempt to infer from sessionKey patterns
    let inferredTelegramChatId = safeTelegramChatId;
    if (!inferredTelegramChatId && sessionKey) {
      inferredTelegramChatId = extractTelegramChatIdFromString(sessionKey);
    }
    if (!safeTelegramChatId && inferredTelegramChatId) {
      console.log('[api/chat] Inferred telegramChatId from sessionKey:', inferredTelegramChatId);
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
    
    // Auto-inject webhook instructions for cron job requests
    let finalMessage = message;
    const isCronRequest = detectCronRequest(message);
    
    if (isCronRequest) {
      const webhookUrl = getAgentWebhookUrl(req);
      console.log('[api/chat] Detected cron request, injecting webhook instructions:', webhookUrl);
      
      // Check if webhook instructions are already in the message
      const hasWebhookInstructions = message.includes(webhookUrl) || 
                                     message.includes('POST') && message.includes('webhook');
      
      if (!hasWebhookInstructions) {
        if (inferredTelegramChatId) {
          // User is chatting via Telegram — inject instructions to deliver cron results
          // directly to their Telegram chat using --channel telegram --to <chat_id>
          console.log('[api/chat] Injecting Telegram delivery instructions for Telegram user:', inferredTelegramChatId);
          finalMessage = `${message}

IMPORTANT: This request comes from a Telegram user (chat ID: ${inferredTelegramChatId}).

When creating this cron job, configure it to deliver results directly to their Telegram chat:
- Use: --channel telegram --to ${inferredTelegramChatId}
- This ensures the cron results are sent back to the user in Telegram

Also POST the FULL result to this webhook URL so the launcher UI is notified: ${webhookUrl}

The webhook payload should be JSON:
{
  "jobName": "your job name",
  "status": "success",
  "content": "your complete response here",
  "timestamp": "ISO timestamp",
  "telegramChatId": "${inferredTelegramChatId}"
}

Set the cron job's delivery mode to "none" (the agent will POST and the Telegram channel flag handles Telegram delivery).`;
          console.log('[api/chat] Injected Telegram + webhook delivery instructions');
        } else {
          // Standard (non-Telegram) cron request: inject webhook POST instructions
          // Agents POST full results themselves; avoids OpenClaw's webhook delivery which only sends summaries
          finalMessage = `${message}

CRITICAL: After completing your work, POST the FULL result to this webhook URL: ${webhookUrl}

Use curl, fetch, or any HTTP tool you have available. The payload should be JSON:
{
  "jobName": "your job name",
  "status": "success",
  "content": "your complete response here",
  "timestamp": "ISO timestamp"
}

Set the cron job's delivery mode to "none" since you're posting the result yourself. This ensures the launcher UI receives your complete response, not just a summary.`;
          console.log('[api/chat] Injected webhook POST instructions');
        }
      } else {
        console.log('[api/chat] Webhook instructions already present, skipping injection');
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
        text: finalMessage
      });
      
      // Check if the response indicates a configuration/ACP runtime error
      const isConfigError = response && (
        response.toLowerCase().includes('acp runtime') ||
        response.toLowerCase().includes('configuration issue') ||
        response.toLowerCase().includes('unable to') && (
          response.toLowerCase().includes('trade') ||
          response.toLowerCase().includes('post') ||
          response.toLowerCase().includes('send')
        )
      );
      
      if (isConfigError) {
        // Agent returned a configuration error - check which skills need setup
        console.log('[api/chat] Agent returned configuration error, checking skill requirements...');
        
        const mentionedSkills = detectMentionedSkills(message);
        const missingRequirements = [];
        
        for (const skillSlug of mentionedSkills) {
          const requirementCheck = checkSkillRequirements(skillSlug);
          if (requirementCheck) {
            missingRequirements.push(requirementCheck);
          }
        }
        
        if (missingRequirements.length > 0) {
          console.log(`[api/chat] Configuration needed for skills: ${mentionedSkills.join(', ')}`);
          
          // Combine all setup instructions
          const allInstructions = missingRequirements
            .map(req => req.setupInstructions)
            .join('\n---\n\n');
          
          const allMissingVars = [...new Set(
            missingRequirements.flatMap(req => req.missingVars)
          )];
          
          return res.status(400).json({
            ok: false,
            error: 'Skill requirements not configured',
            skills: mentionedSkills,
            missingRequirements,
            missingVars: allMissingVars,
            setupInstructions: allInstructions,
            helpUrl: 'https://github.com/buildonlabs-org/openclaw-agent#environment-variables',
            originalResponse: response
          });
        }
      }
      
      // VERIFICATION STEP: Check if any cron jobs were created/modified without webhooks
      // This catches cases where pattern detection missed or agent created cron differently
      const cronJobsFixed = await verifyCronWebhooksAfterChat(req);
      
      // Clean up webhook URL details from response for cleaner user experience
      const cleanedResponse = cleanupCronResponse(response);
      
      res.json({
        ok: true,
        agentId,
        sessionKey: finalSessionKey,
        response: cleanedResponse,
        timestamp: new Date().toISOString(),
        cronDetected: isCronRequest,
        telegramChatId: inferredTelegramChatId || undefined,
        cronJobsFixed // Number of cron jobs that were automatically fixed
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

/**
 * Verify all cron jobs use delivery mode "none" (agent posts results themselves)
 * Automatically fixes any using the old webhook delivery mode
 */
async function verifyCronWebhooksAfterChat(req) {
  try {
    // List all cron jobs
    const result = await runCmd(OPENCLAW_CLI, ["cron", "list", "--json"]);
    if (result.code !== 0) {
      console.warn('[verify-delivery] Failed to list cron jobs:', result.error);
      return 0;
    }
    
    // Parse and normalize the output
    let jobs = [];
    try {
      const parsed = JSON.parse(result.output);
      if (Array.isArray(parsed)) {
        jobs = parsed;
      } else if (parsed && typeof parsed === 'object') {
        jobs = parsed.jobs || parsed.items || parsed.data || [parsed];
      }
    } catch (parseErr) {
      console.error('[verify-delivery] Failed to parse JSON:', parseErr.message);
      return 0;
    }
    
    let fixedCount = 0;
    
    for (const job of jobs) {
      // Check if job is using old webhook delivery mode (only sends summaries)
      const usesOldWebhookMode = job.delivery?.mode === 'webhook';
      
      if (usesOldWebhookMode) {
        console.log(`[verify-delivery] Fixing cron job to use delivery=none: ${job.name} (${job.id})`);
        console.log(`[verify-delivery] Agent will POST full results themselves instead`);
        
        // Update the job to use delivery mode "none"
        // The agent will POST full results to the webhook themselves
        const updateResult = await runCmd(OPENCLAW_CLI, [
          "cron", "update", job.id,
          "--delivery", "none"
        ]);
        
        if (updateResult.code === 0) {
          console.log(`[verify-delivery] ✅ Fixed: ${job.name} - now uses delivery=none`);
          fixedCount++;
        } else {
          console.error(`[verify-delivery] ❌ Failed to fix: ${job.name}`, updateResult.error);
        }
      }
    }
    
    if (fixedCount > 0) {
      console.log(`[verify-delivery] Fixed ${fixedCount} cron job(s) to use delivery=none`);
    }
    
    return fixedCount;
  } catch (error) {
    console.error('[verify-delivery] Error during verification:', error);
    return 0;
  }
}

/**
 * Clean up agent response by removing webhook URL details
 * Makes responses cleaner for end users
 */
function cleanupCronResponse(response) {
  if (!response || typeof response !== 'string') {
    return response;
  }
  
  let cleaned = response;
  
  // Replace variations of "to [your/the] specified webhook URL:" (with colon) with "here."
  cleaned = cleaned.replace(/to (your|the) specified webhook URL:\s*/gi, 'here.\n');
  
  // Also handle without colon
  cleaned = cleaned.replace(/to (your|the) specified webhook URL/gi, 'here');
  cleaned = cleaned.replace(/to the webhook URL/gi, 'here');
  cleaned = cleaned.replace(/to webhook URL/gi, 'here');
  
  // Remove entire lines or sections mentioning webhook URL with actual URL
  // This catches "Webhook URL: https://..." on its own line
  cleaned = cleaned.replace(/^Webhook URL:.*$/gim, '');
  cleaned = cleaned.replace(/^- Webhook URL:.*$/gim, '');
  cleaned = cleaned.replace(/^\*\*Webhook URL\*\*:.*$/gim, '');
  
  // Remove webhook URL if it appears inline with https://
  cleaned = cleaned.replace(/Webhook URL:\s*https?:\/\/[^\s\n]+/gi, '');
  cleaned = cleaned.replace(/webhook URL:\s*https?:\/\/[^\s\n]+/gi, '');
  
  // Clean up any extra blank lines that might have been created
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Trim any trailing whitespace
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * Detect if a message is requesting to create/configure a cron job
 * Supports English and basic patterns in other major languages
 */
function detectCronRequest(message) {
  const lowerMessage = message.toLowerCase();
  
  // Patterns that indicate cron job creation/configuration
  const cronPatterns = [
    // ========== ENGLISH PATTERNS ==========
    
    // Explicit cron mentions
    /\bcron\s+job\b/i,
    /\bcron\s+add\b/i,
    /\bcreate.*cron/i,
    /\bschedule.*task/i,
    /\bschedule.*job/i,
    /\brecurring.*task/i,
    /\bautomated.*task/i,
    /\bset.*reminder/i,
    /\bruns?\s+every\b/i,
    
    // Time frequency patterns - "every X"
    /\bevery\s+\d*\s*(second|minute|hour|day|week|month|year)/i,
    /\bevery\s+(few|couple|other)\s+(seconds?|minutes?|hours?|days?)/i,
    /\beach\s+\d*\s*(minute|hour|day|week|month)/i,
    
    // Action verbs + "every" - broad coverage
    /\b(send|notify|alert|tell|inform|ping|message|email|text)\s+(me|us)?\s*.*\bevery\b/i,
    /\b(check|monitor|watch|track|scan|poll|query|fetch|get|pull|retrieve)\s*.*\bevery\b/i,
    /\b(update|report|notify|alert|show|give|provide|share)\s+(me|us)?\s*.*\bevery\b/i,
    
    // "Keep me" patterns
    /\bkeep\s+(me|us)\s+(updated|informed|notified|posted|in\s+the\s+loop)/i,
    /\bkeep\s+(track|tabs|an\s+eye)\s+(of|on)/i,
    
    // "Let me know" patterns  
    /\blet\s+(me|us)\s+know.*\b(every|when|if)/i,
    /\binform\s+(me|us).*\b(every|regularly|periodically)/i,
    
    // Monitoring/watching language
    /\bmonitor\s+(this|that|the|it|\w+)\s+(for\s+me|regularly|continuously)?/i,
    /\bwatch\s+(for|out\s+for).*\b(changes?|updates?)/i,
    /\bstay\s+(on\s+top\s+of|informed|updated)/i,
    /\bfollow\s+.*\b(regularly|closely)/i,
    /\bobserve\s+.*\b(continuously|regularly)/i,
    
    // "I want/need" patterns with frequency
    /\bi\s+(want|need|would\s+like).*\bevery\b/i,
    /\bi\s+(want|need|would\s+like).*\b(daily|hourly|weekly|regularly)/i,
    
    // Update/notification requests
    /\b(get|receive|have)\s+(updates?|notifications?|alerts?).*\b(every|regular|periodic)/i,
    /\bnotify.*\b(every|when|if).*\b(minute|hour|day|changes?)/i,
    
    // Time-based triggers
    /\bdaily\s+(at|by|trigger|run|send|notify|check|update)/i,
    /\bhourly\s+(trigger|run|send|notify|check|update)/i,
    /\bweekly\s+(trigger|run|send|notify|check|update)/i,
    /\bmonthly\s+(trigger|run|send|notify|check|update)/i,
    /\bat\s+\d+\s*(am|pm|:\d+)/i,
    /\bevery\s+(morning|evening|night|noon)/i,
    
    // Frequency adverbs
    /\b(regularly|periodically|continuously|constantly|repeatedly|routinely)\s+(check|send|notify|update|monitor)/i,
    /\b(check|send|notify|update|monitor).*\b(regularly|periodically|continuously|constantly|repeatedly)/i,
    
    // Interval patterns
    /\bat\s+\d+\s+(minute|hour|day)\s+intervals?/i,
    /\bon\s+an?\s+(hourly|daily|weekly|regular|periodic)\s+basis/i,
    
    // "Make sure" / "Ensure" patterns
    /\b(make\s+sure|ensure|see\s+to\s+it)\s+.*\b(every|regularly|continuously)/i,
    
    // Automation indicators
    /\bautomate.*\b(checking|monitoring|sending|notifying)/i,
    /\bset\s+up.*\b(automatic|automated|recurring)/i,
    
    // Reminder patterns
    /\bremind\s+(me|us).*\bevery\b/i,
    /\breminder.*\b(every|daily|hourly|weekly)/i,
    
    // ========== SPANISH PATTERNS ==========
    /\bcada\s+\d*\s*(segundo|minuto|hora|día|dia|semana|mes)/i,  // "cada X" = "every X"
    /\b(enviar|notificar|avisar|informar).*\bcada\b/i,            // "send/notify every"
    /\b(verificar|monitorear|revisar).*\bcada\b/i,                // "check/monitor every"
    /\bdiariamente\b/i,                                            // "daily"
    /\bcada\s+(mañana|tarde|noche)/i,                             // "every morning/afternoon/night"
    /\bmantenerme\s+(actualizado|informado)/i,                    // "keep me updated/informed"
    
    // ========== FRENCH PATTERNS ==========
    /\bchaque\s+\d*\s*(seconde|minute|heure|jour|semaine|mois)/i, // "chaque X" = "every X"
    /\b(envoyer|notifier|informer).*\bchaque\b/i,                 // "send/notify every"
    /\b(vérifier|surveiller|contrôler).*\bchaque\b/i,            // "check/monitor every"
    /\btous\s+les\s+(jours|heures)/i,                             // "tous les jours" = "every day"
    /\bquotidiennement\b/i,                                        // "daily"
    /\bme\s+tenir\s+(au\s+courant|informé)/i,                     // "keep me informed"
    
    // ========== GERMAN PATTERNS ==========
    /\bjede[ns]?\s+\d*\s*(Sekunde|Minute|Stunde|Tag|Woche|Monat)/i, // "jede X" = "every X"
    /\b(senden|benachrichtigen|informieren).*\bjede/i,            // "send/notify every"
    /\b(prüfen|überwachen|kontrollieren).*\bjede/i,              // "check/monitor every"
    /\btäglich\b/i,                                               // "daily"
    /\bstündlich\b/i,                                             // "hourly"
    /\bmich\s+(auf\s+dem\s+Laufenden|informiert)\s+halten/i,    // "keep me informed"
    
    // ========== PORTUGUESE PATTERNS ==========
    /\bcada\s+\d*\s*(segundo|minuto|hora|dia|semana|mês)/i,      // "cada X" = "every X"
    /\b(enviar|notificar|avisar|informar).*\bcada\b/i,           // "send/notify every"
    /\b(verificar|monitorar|verificar).*\bcada\b/i,              // "check/monitor every"
    /\bdiariamente\b/i,                                           // "daily"
    /\bme\s+manter\s+(atualizado|informado)/i,                   // "keep me updated"
    
    // ========== ITALIAN PATTERNS ==========
    /\bogni\s+\d*\s*(secondo|minuto|ora|giorno|settimana|mese)/i, // "ogni X" = "every X"
    /\b(inviare|notificare|avvisare).*\bogni\b/i,                // "send/notify every"
    /\b(verificare|monitorare|controllare).*\bogni\b/i,          // "check/monitor every"
    /\bquotidianamente\b/i,                                       // "daily"
    /\btenermi\s+(aggiornato|informato)/i,                        // "keep me updated"
    
    // ========== CHINESE PATTERNS ==========
    /每\s*\d*\s*(秒|分钟|小时|天|周|月)/,                          // "měi X" = "every X"
    /定时|定期/,                                                    // "scheduled/regular"
    /每天|每日/,                                                    // "every day/daily"
  ];
  
  return cronPatterns.some(pattern => pattern.test(lowerMessage));
}

/**
 * Known skill requirements - maps skill slugs to required environment variables
 * This is a curated list of common skills with known requirements
 */
const KNOWN_SKILL_REQUIREMENTS = {
  'polymarket-odds': {
    envVars: ['POLYMARKET_API_KEY', 'POLYMARKET_PRIVATE_KEY'],
    anyOf: true, // Only one is required
    setupInstructions: [
      '⚠️ **Polymarket Skill Requires API Credentials**',
      '',
      'To use Polymarket skill, add ONE of these API keys:',
      '- `POLYMARKET_API_KEY` - Get from polymarket.com/settings',
      '- `POLYMARKET_PRIVATE_KEY` - Your Polymarket wallet private key',
      '',
      '**Steps:**',
      '1. Go to Settings',
      '2. Add the API key',
      '3. Save changes',
      ''
    ]
  },
  'hyperliquid-cli': {
    envVars: ['HYPERLIQUID_API_KEY', 'HYPERLIQUID_PRIVATE_KEY', 'AGENT_WALLET_PRIVATE_KEY'],
    anyOf: true,
    setupInstructions: [
      '⚠️ **Hyperliquid Skill Requires Credentials**',
      '',
      'To use Hyperliquid skill, add ONE of these API keys:',
      '- `HYPERLIQUID_API_KEY` - Get from hyperliquid.xyz/settings',
      '- `HYPERLIQUID_PRIVATE_KEY` - Your Hyperliquid wallet private key',
      '- `AGENT_WALLET_PRIVATE_KEY` - Use agent\'s own wallet (fund it first)',
      '',
      '**Steps:**',
      '1. Go to Settings',
      '2. Add the API key',
      '3. Save changes',
      ''
    ]
  },
  'onchain': {
    envVars: ['AGENT_WALLET_PRIVATE_KEY'],
    setupInstructions: [
      '⚠️ **Onchain Skill Requires Wallet**',
      '',
      'To use onchain operations, you need a funded crypto wallet.',
      '',
      '**Option 1: Use auto-generated wallet**',
      '- Check /api/wallet for your agent\'s address',
      '- Fund it with ETH/MATIC/USDC',
      '',
      '**Option 2: Provide your own wallet**',
      '1. Go to Settings',
      '2. Add: `AGENT_WALLET_PRIVATE_KEY=0x...`',
      '3. Save changes',
      ''
    ]
  },
  'duckduckgo-search': {
    envVars: [], // No API key required
    setupInstructions: []
  },
  'twitter': {
    envVars: ['TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET'],
    setupInstructions: [
      '⚠️ **Twitter Skill Requires API Credentials**',
      '',
      'To use Twitter skill, add these API keys in Settings:',
      '- `TWITTER_API_KEY`',
      '- `TWITTER_API_SECRET`',
      '- `TWITTER_ACCESS_TOKEN`',
      '- `TWITTER_ACCESS_SECRET`',
      '',
      '**Get credentials from:** developer.twitter.com',
      ''
    ]
  },
  'telegram': {
    envVars: ['TELEGRAM_BOT_TOKEN'],
    setupInstructions: [
      '⚠️ **Telegram Skill Requires Bot Token**',
      '',
      'To use Telegram skill, add this API key in Settings:',
      '- `TELEGRAM_BOT_TOKEN` - Get from @BotFather on Telegram',
      '',
      '**Steps:**',
      '1. Message @BotFather on Telegram',
      '2. Create a new bot',
      '3. Copy the token',
      '4. Go to Settings and add the API key',
      ''
    ]
  },
  'discord': {
    envVars: ['DISCORD_BOT_TOKEN'],
    setupInstructions: [
      '⚠️ **Discord Skill Requires Bot Token**',
      '',
      'To use Discord skill, add this API key in Settings:',
      '- `DISCORD_BOT_TOKEN` - Get from discord.com/developers',
      '',
      '**Steps:**',
      '1. Go to discord.com/developers/applications',
      '2. Create application → Bot',
      '3. Copy the token',
      '4. Go to Settings and add the API key',
      ''
    ]
  },
  'gmail': {
    envVars: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'],
    setupInstructions: [
      '⚠️ **Gmail Skill Requires OAuth Credentials**',
      '',
      'To use Gmail skill, add these API keys in Settings:',
      '- `GMAIL_CLIENT_ID`',
      '- `GMAIL_CLIENT_SECRET`',
      '- `GMAIL_REFRESH_TOKEN`',
      '',
      '**Get credentials from:** console.cloud.google.com',
      ''
    ]
  },
  'github': {
    envVars: ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN'],
    anyOf: true,
    setupInstructions: [
      '⚠️ **GitHub Skill Requires Access Token**',
      '',
      'To use GitHub skill, add this API key in Settings:',
      '- `GITHUB_TOKEN` or `GITHUB_PERSONAL_ACCESS_TOKEN`',
      '',
      '**Get token from:** github.com/settings/tokens',
      ''
    ]
  }
};

/**
 * Detect which skill the user is trying to use based on message content
 * Returns array of skill slugs that might be mentioned
 */
function detectMentionedSkills(message) {
  const lowerMessage = message.toLowerCase();
  const mentionedSkills = [];
  
  // Check for explicit skill mentions
  for (const [slug, requirements] of Object.entries(KNOWN_SKILL_REQUIREMENTS)) {
    // Convert hyphe-separated to searchable patterns
    const searchTerms = slug.split('-');
    
    // Check if message mentions the skill
    if (searchTerms.some(term => lowerMessage.includes(term))) {
      mentionedSkills.push(slug);
    }
  }
  
  // Fuzzy detection for common use cases
  if (lowerMessage.match(/\b(trade|trading|market|bet)\b/) && lowerMessage.includes('polymarket')) {
    if (!mentionedSkills.includes('polymarket-odds')) mentionedSkills.push('polymarket-odds');
  }
  
  if (lowerMessage.match(/\b(trade|trading|perpetual|futures)\b/) && lowerMessage.includes('hyperliquid')) {
    if (!mentionedSkills.includes('hyperliquid-cli')) mentionedSkills.push('hyperliquid-cli');
  }
  
  if (lowerMessage.match(/\b(send|transfer|swap|on-chain|onchain|blockchain)\b/)) {
    if (!mentionedSkills.includes('onchain')) mentionedSkills.push('onchain');
  }
  
  if (lowerMessage.match(/\b(tweet|twitter|post.*twitter)\b/)) {
    if (!mentionedSkills.includes('twitter')) mentionedSkills.push('twitter');
  }
  
  if (lowerMessage.match(/\b(telegram|tg)\b/)) {
    if (!mentionedSkills.includes('telegram')) mentionedSkills.push('telegram');
  }
  
  if (lowerMessage.match(/\b(discord)\b/)) {
    if (!mentionedSkills.includes('discord')) mentionedSkills.push('discord');
  }
  
  if (lowerMessage.match(/\b(email|gmail|send.*mail)\b/)) {
    if (!mentionedSkills.includes('gmail')) mentionedSkills.push('gmail');
  }
  
  if (lowerMessage.match(/\b(github|repository|repo|pr|pull request)\b/)) {
    if (!mentionedSkills.includes('github')) mentionedSkills.push('github');
  }
  
  return mentionedSkills;
}

/**
 * Check if required environment variables are set for a skill
 * Returns null if all requirements met, or error object if missing
 */
function checkSkillRequirements(skillSlug) {
  const requirements = KNOWN_SKILL_REQUIREMENTS[skillSlug];
  
  if (!requirements || requirements.envVars.length === 0) {
    return null; // No requirements or skill not tracked
  }
  
  const { envVars, anyOf = false, setupInstructions } = requirements;
  const missingVars = [];
  const presentVars = [];
  
  // Check which variables are set
  for (const envVar of envVars) {
    if (process.env[envVar]) {
      presentVars.push(envVar);
    } else {
      missingVars.push(envVar);
    }
  }
  
  // Determine if requirements are met
  const requirementsMet = anyOf 
    ? presentVars.length > 0  // At least one variable is set
    : missingVars.length === 0; // All variables are set
  
  if (requirementsMet) {
    return null; // All good!
  }
  
  // Build error response
  const varList = anyOf 
    ? `Any of: ${envVars.join(', ')}`
    : envVars.join(', ');
  
  return {
    skill: skillSlug,
    requiredVars: envVars, 
    missingVars: anyOf ? envVars : missingVars,
    anyOf,
    setupInstructions: setupInstructions.join('\n')
  };
}

/**
 * Get the agent's webhook URL for cron delivery
 */
function getAgentWebhookUrl(req) {
  // Determine the agent's public URL
  const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN || 
                      process.env.RAILWAY_STATIC_URL ||
                      (req ? req.get('host') : null);
  
  const protocol = publicDomain?.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${publicDomain}/api/openclaw-cron-webhook`;
}

const TELEGRAM_CHAT_ID_MIN = -(2n ** 63n); // Telegram chat IDs are int64 in the Bot API
const TELEGRAM_CHAT_ID_MAX = (2n ** 63n) - 1n;

/**
 * Validate a Telegram chat ID.
 * Telegram chat IDs are integers: positive for users/private chats, negative for groups/channels.
 * @param {*} value - Value to validate
 * @returns {string|null} Trimmed numeric string if valid, null otherwise
 */
function parseTelegramChatId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }
  try {
    const numericValue = BigInt(trimmed);
    if (numericValue < TELEGRAM_CHAT_ID_MIN || numericValue > TELEGRAM_CHAT_ID_MAX) {
      return null;
    }
  } catch {
    return null;
  }
  return trimmed;
}

/**
 * Extract a Telegram chat ID from a string containing a telegram/tg marker.
 * Supports patterns like (delimiter required):
 * - "telegram:123456789"
 * - "tg-123456789"
 * - "tg_123456789"
 * - "session:telegram:123456789"
 */
function extractTelegramChatIdFromString(value) {
  if (!value) return null;
  const raw = String(value);
  const match = raw.match(/(?:telegram|tg)[:\-_](-?\d{1,19})(?!\d)/i);
  if (match) {
    const candidate = match[1];
    return parseTelegramChatId(candidate);
  }
  return null;
}

/**
 * Resolve Telegram chat ID from webhook payload/job/run metadata.
 */
function resolveTelegramChatId(payload, job, run) {
  const directCandidates = [
    payload?.telegramChatId,
    payload?.telegram_chat_id,
    job?.telegramChatId,
    job?.delivery?.channel === 'telegram' ? job?.delivery?.to : null,
    payload?.delivery?.channel === 'telegram' ? payload?.delivery?.to : null,
    run?.delivery?.channel === 'telegram' ? run?.delivery?.to : null
  ];

  for (const candidate of directCandidates) {
    const parsed = parseTelegramChatId(candidate);
    if (parsed) return parsed;
  }

  const sessionCandidates = [
    job?.sessionTarget,
    payload?.sessionTarget,
    run?.sessionTarget,
    payload?.session
  ];

  for (const candidate of sessionCandidates) {
    const parsed = extractTelegramChatIdFromString(candidate);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Send a message to a Telegram chat via the OpenClaw CLI.
 * Used to deliver cron job results back to the Telegram user who set up the job.
 *
 * Callers MUST pass a validated chat ID (use parseTelegramChatId first).
 * This function still defensively validates to guard against direct calls.
 *
 * @param {string} chatId - Telegram chat ID (validated numeric string, may be negative for groups)
 * @param {string} message - Message text to send
 * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
 */
async function sendTelegramMessage(chatId, message) {
  if (!chatId || !message) {
    return { ok: false, error: 'Missing chatId or message' };
  }

  // Defensive: ensure the chat ID is still in the expected numeric format
  if (!parseTelegramChatId(chatId)) {
    console.warn('[telegram-send] Invalid chat ID format:', chatId);
    return { ok: false, error: 'Invalid Telegram chat ID format' };
  }

  try {
    console.log(`[telegram-send] Sending message to Telegram chat ${chatId} (${message.length} chars)`);
    const result = await runCmd(OPENCLAW_CLI, [
      'deliver',
      '--channel', 'telegram',
      '--to', String(chatId),
      message
    ]);

    if (result.code === 0) {
      console.log(`[telegram-send] ✅ Message delivered to Telegram chat ${chatId}`);
      return { ok: true, output: result.output };
    } else {
      console.error(`[telegram-send] ❌ Failed to deliver to Telegram chat ${chatId}:`, result.error || result.output);
      return { ok: false, error: result.error || result.output || 'Delivery failed' };
    }
  } catch (err) {
    console.error(`[telegram-send] Error sending to Telegram:`, err.message);
    return { ok: false, error: err.message };
  }
}


/**
 * Start periodic audit to ensure all cron jobs use delivery=none
 * Runs every 5 minutes
 */
let periodicAuditInterval = null;
function startPeriodicCronWebhookAudit() {
  // Don't start if already running
  if (periodicAuditInterval) {
    console.log('[periodic-audit] Already running');
    return;
  }
  
  const AUDIT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  
  console.log('[periodic-audit] Starting cron delivery mode audit (every 5 minutes)');
  
  // Run immediately on start
  performCronWebhookAudit();
  
  // Then run periodically
  periodicAuditInterval = setInterval(() => {
    performCronWebhookAudit();
  }, AUDIT_INTERVAL);
}

/**
 * Perform the actual audit - check and fix cron jobs
 * Ensures all jobs use delivery=none so agents POST full results themselves
 */
async function performCronWebhookAudit() {
  try {
    // Only run if configured
    if (!isConfigured()) {
      return;
    }
    
    console.log('[periodic-audit] Checking cron jobs for delivery mode...');
    
    const result = await runCmd(OPENCLAW_CLI, ["cron", "list", "--json"]);
    if (result.code !== 0) {
      console.warn('[periodic-audit] Failed to list cron jobs');
      return;
    }
    
    // Parse and normalize the output
    let jobs = [];
    try {
      const parsed = JSON.parse(result.output);
      if (Array.isArray(parsed)) {
        jobs = parsed;
      } else if (parsed && typeof parsed === 'object') {
        jobs = parsed.jobs || parsed.items || parsed.data || [parsed];
      }
    } catch (parseErr) {
      console.error('[periodic-audit] Failed to parse JSON:', parseErr.message);
      return;
    }
    
    let fixedCount = 0;
    
    for (const job of jobs) {
      // Check if job is using old webhook delivery mode (only sends summaries)
      const usesOldWebhookMode = job.delivery?.mode === 'webhook';
      
      if (usesOldWebhookMode) {
        console.log(`[periodic-audit] Fixing cron job to use delivery=none: ${job.name} (${job.id})`);
        
        const updateResult = await runCmd(OPENCLAW_CLI, [
          "cron", "update", job.id,
          "--delivery", "none"
        ]);
        
        if (updateResult.code === 0) {
          console.log(`[periodic-audit] ✅ Fixed: ${job.name} - now uses delivery=none`);
          fixedCount++;
        } else {
          console.error(`[periodic-audit] ❌ Failed to fix: ${job.name}`);
        }
      }
    }
    
    if (fixedCount > 0) {
      console.log(`[periodic-audit] Fixed ${fixedCount} cron job(s) to use delivery=none`);
    } else if (jobs.length > 0) {
      console.log(`[periodic-audit] All ${jobs.length} cron job(s) using correct delivery mode ✓`);
    }
  } catch (error) {
    console.error('[periodic-audit] Error during audit:', error.message);
  }
}

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

// POST /api/telegram/send - Send a message to a specific Telegram chat
// Used to deliver cron job results or notifications to users who set up jobs via Telegram
app.post("/api/telegram/send", requireApiKey, async (req, res) => {
  try {
    const { chatId, message } = req.body || {};

    if (!chatId || !message) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: chatId and message'
      });
    }

    // Validate chat ID: Telegram chat IDs are integers (positive for users, negative for groups)
    const safeChatId = parseTelegramChatId(chatId);
    if (!safeChatId) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid Telegram chat ID: must be a numeric value'
      });
    }

    const result = await sendTelegramMessage(safeChatId, String(message));

    if (result.ok) {
      return res.json({ ok: true, chatId: safeChatId, delivered: true, output: result.output });
    } else {
      return res.status(502).json({ ok: false, error: result.error, chatId: safeChatId });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});


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
  // API routes should be handled by their specific handlers above
  // If we reach here with /api/* path, it means no handler matched
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ 
      ok: false, 
      error: "Endpoint not found" 
    });
  }
  
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

// Global wallet instance
let agentWallet = null;

const server = app.listen(PORT, () => {
  console.log(`[wrapper] listening on port ${PORT}`);
  console.log(`[wrapper] setup wizard: http://localhost:${PORT}/setup`);
  console.log(`[wrapper] configured: ${isConfigured()}`);
  console.log(`[wrapper] gateway token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 12)}...`);

  // Copy cached skills from Docker image to workspace
  (async () => {
    try {
      console.log("[wrapper] copying cached skills to workspace...");
      const result = await copyCachedSkillsToWorkspace();
      if (result.copied > 0) {
        console.log(`[wrapper] installed ${result.copied} skills from cache`);
      }
      if (result.skipped > 0) {
        console.log(`[wrapper] skipped ${result.skipped} skills (already exist)`);
      }
      if (result.errors > 0) {
        console.warn(`[wrapper] failed to copy ${result.errors} skills`);
      }
    } catch (err) {
      console.error(`[wrapper] skill cache setup failed: ${err.message}`);
    }
  })();

  // Initialize wallet immediately (doesn't depend on gateway being configured)
  (async () => {
    try {
      console.log("[wrapper] initializing agent wallet...");
      agentWallet = await initializeWallet(STATE_DIR);
      const walletInfo = agentWallet.getInfo();
      console.log(`[wrapper] wallet ready: ${walletInfo.address}`);
      
      // Expose wallet address to gateway via environment variable
      // This allows the agent to know and respond with its own wallet address
      process.env.AGENT_WALLET_ADDRESS = walletInfo.address;
      
      // Also write to a file that skills can read
      try {
        const walletInfoPath = path.join(STATE_DIR, "wallet-info.json");
        fs.writeFileSync(walletInfoPath, JSON.stringify({
          address: walletInfo.address,
          type: walletInfo.type,
          chains: walletInfo.chains,
          note: "This is the agent's crypto wallet. Fund it to enable on-chain operations.",
          initialized: new Date().toISOString()
        }, null, 2));
        console.log(`[wrapper] wallet info written to ${walletInfoPath}`);
      } catch (err) {
        console.warn(`[wrapper] failed to write wallet info file: ${err.message}`);
      }
    } catch (err) {
      console.error(`[wrapper] wallet initialization failed: ${err.message}`);
    }
  })();

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
      
      // Start periodic cron webhook audit (runs every 5 minutes)
      startPeriodicCronWebhookAudit();
    })().catch((err) => {
      console.error(`[wrapper] failed to start gateway at boot: ${err.message}`);
    });
  } else if (DEFAULT_OPENAI_KEY) {
    // Auto-onboard if not configured but DEFAULT_OPENAI_KEY is available
    (async () => {
      try {
        console.log("[wrapper] AUTO-ONBOARDING: Not configured but DEFAULT_OPENAI_KEY is set");
        console.log("[wrapper] AUTO-ONBOARDING: Running automatic setup with default credentials...");
        
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

        const onboardArgs = buildOnboardArgs({});
        console.log("[wrapper] AUTO-ONBOARDING: Starting onboarding with default OpenAI credentials...");
        const onboard = await runCmd(OPENCLAW_CLI, onboardArgs);

        const ok = onboard.code === 0 && isConfigured();
        console.log(`[wrapper] AUTO-ONBOARDING: Onboarding exit=${onboard.code} configured=${isConfigured()}`);

        if (ok) {
          console.log("[wrapper] AUTO-ONBOARDING: Configuring gateway settings...");

          // Set gateway token in config
          await runCmd(OPENCLAW_CLI, [
            "config", "set", "gateway.auth.token", OPENCLAW_GATEWAY_TOKEN,
          ]);

          // Set allowInsecureAuth
          await runCmd(OPENCLAW_CLI, [
            "config", "set", "gateway.controlUi.allowInsecureAuth", "true",
          ]);

          // Set trusted proxies
          await runCmd(OPENCLAW_CLI, [
            "config", "set", "--json", "gateway.trustedProxies", '["127.0.0.1"]',
          ]);

          // Configure allowed origins
          const allowedOrigins = ["http://localhost:8080", "http://127.0.0.1:8080"];
          if (process.env.RAILWAY_PUBLIC_DOMAIN) {
            allowedOrigins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
          }
          if (process.env.RAILWAY_STATIC_URL) {
            allowedOrigins.push(process.env.RAILWAY_STATIC_URL);
          }
          allowedOrigins.push("https://*.railway.app");
          
          await runCmd(OPENCLAW_CLI, [
            "config", "set", "--json", "gateway.controlUi.allowedOrigins", 
            JSON.stringify(allowedOrigins),
          ]);

          // Set model with provider prefix (since we default to openai-api-key)
          const fullModelName = DEFAULT_MODEL.includes('/') ? DEFAULT_MODEL : `openai/${DEFAULT_MODEL}`;
          console.log(`[wrapper] AUTO-ONBOARDING: Setting model to ${fullModelName}...`);
          await runCmd(OPENCLAW_CLI, ["models", "set", fullModelName]);

          console.log("[wrapper] AUTO-ONBOARDING: Starting gateway...");
          await ensureGatewayRunning();
          
          // Start periodic cron webhook audit
          startPeriodicCronWebhookAudit();
          
          console.log("[wrapper] AUTO-ONBOARDING: ✅ Agent fully configured and ready!");
        } else {
          console.error("[wrapper] AUTO-ONBOARDING: ❌ Failed to complete onboarding");
          console.error(onboard.output);
        }
      } catch (err) {
        console.error(`[wrapper] AUTO-ONBOARDING: ❌ Error: ${err.message}`);
      }
    })().catch((err) => {
      console.error(`[wrapper] AUTO-ONBOARDING failed: ${err.message}`);
    });
  } else {
    console.log("[wrapper] Not configured and no DEFAULT_OPENAI_API_KEY set");
    console.log("[wrapper] Visit /setup or set DEFAULT_OPENAI_API_KEY in Railway to auto-configure");
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
