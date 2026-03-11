// gatewayClient.js
import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Generate or load a persistent device ID for Gateway pairing
function getOrCreateDeviceId(stateDir) {
  const deviceIdPath = path.join(stateDir, "device.id");
  
  try {
    if (fs.existsSync(deviceIdPath)) {
      const deviceId = fs.readFileSync(deviceIdPath, "utf8").trim();
      if (deviceId) {
        console.log(`[gateway] ═══════════════════════════════════════════════════════════`);
        console.log(`[gateway] Using existing device ID: ${deviceId}`);
        console.log(`[gateway] ═══════════════════════════════════════════════════════════`);
        return deviceId;
      }
    }
  } catch (err) {
    console.warn(`[gateway] Failed to read device ID: ${err.message}`);
  }
  
  // Generate new device ID
  const deviceId = crypto.randomBytes(16).toString("hex");
  
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(deviceIdPath, deviceId);
    console.log(`[gateway] ═══════════════════════════════════════════════════════════`);
    console.log(`[gateway] Generated NEW device ID: ${deviceId}`);
    console.log(`[gateway] ⚠️  DEVICE PAIRING WILL BE REQUIRED`);
    console.log(`[gateway] ═══════════════════════════════════════════════════════════`);
  } catch (err) {
    console.error(`[gateway] Failed to persist device ID: ${err.message}`);
  }
  
  return deviceId;
}

export class OpenClawGatewayClient {
  constructor({ gatewayUrl, token, stateDir }) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
    this.stateDir = stateDir || process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
    this.deviceId = getOrCreateDeviceId(this.stateDir);

    this.ws = null;
    this.ready = false;
    this.pending = new Map(); // reqId -> { resolve, reject, chunks, done }
    this.messageId = 1;
    this.lastChatReqId = null; // Track latest chat request for event routing
    this.pairingRequired = false; // Track if device pairing is needed
  }

  async connect() {
    if (this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) return;

    // If a prior socket exists, close it
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    this.ready = false;
    console.log(`[gateway] Connecting to Gateway with device ID: ${this.deviceId}`);

    this.ws = new WebSocket(this.gatewayUrl);

    this.ws.on("open", () => {
      console.log(`[gateway] WebSocket connection opened, waiting for challenge...`);
    });

    this.ws.on("message", (data) => this._onMessage(data));
    
    this.ws.on("close", (code, reason) => {
      const reasonStr = reason?.toString() || "";
      console.warn(`[gateway] ═══════════════════════════════════════════════════════════`);
      console.warn(`[gateway] WebSocket CLOSED - Code: ${code}, Reason: ${reasonStr || '(none)'}`);
      
      this.ready = false;
      
      // Detect pairing requirement from close code 1008
      if (code === 1008 || reasonStr.includes("pairing") || reasonStr.includes("connect failed")) {
        this.pairingRequired = true;
        console.warn(`[gateway] ⚠️  DEVICE PAIRING REQUIRED`);
        console.warn(`[gateway] Device ID: ${this.deviceId}`);
        console.warn(`[gateway] `);
        console.warn(`[gateway] To approve this device:`);
        console.warn(`[gateway]   1. List pending devices: openclaw devices list`);
        console.warn(`[gateway]   2. Approve device: openclaw devices approve <requestId>`);
        console.warn(`[gateway]   3. Or use API: GET /api/devices then POST /api/devices/approve`);
        console.warn(`[gateway] ═══════════════════════════════════════════════════════════`);
      } else {
        console.warn(`[gateway] ═══════════════════════════════════════════════════════════`);
      }
      
      // fail all pending
      for (const [id, p] of this.pending.entries()) {
        p.reject(new Error(`gateway connection closed (${code}): ${reasonStr}`));
        this.pending.delete(id);
      }
    });
    
    this.ws.on("error", (err) => {
      this.ready = false;
      console.error(`[gateway] WebSocket error:`, err.message);
    });

    // Wait until ready
    const start = Date.now();
    while (!this.ready) {
      if (Date.now() - start > 10_000) {
        console.error(`[gateway] Connection timeout after 10s`);
        // If pairing is required, throw a more helpful error
        if (this.pairingRequired) {
          throw new Error(`Gateway connection failed: Device pairing required. Device ID: ${this.deviceId}. Run: openclaw devices list && openclaw devices approve <requestId>`);
        }
        throw new Error("Gateway connect timeout");
      }
      await sleep(50);
    }
    
    console.log(`[gateway] ✓ Connected successfully`);
  }

  _send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    // Debug logging
    console.log("[gateway] <=", msg.type, msg.event || msg.id || "", msg.ok === false ? msg.error : "");

    // 1) Challenge -> send connect with device pairing for privileged operations
    if (msg.type === "event" && msg.event === "connect.challenge") {
      console.log(`[gateway] Received challenge, sending connect with device: ${this.deviceId.slice(0, 8)}...`);
      
      this._send({
        type: "req",
        id: "c1",
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: "cli", version: "1.0.0", platform: "linux", mode: "cli" },
          role: "operator",
          scopes: ["operator.read", "operator.write", "operator.admin"],
          caps: [],
          commands: [],
          permissions: {},
          auth: { token: this.token },
          locale: "en-US",
          userAgent: "backend-gateway-client",
          // Include device ID for pairing support (required for privileged ops like skill install)
          device: {
            id: this.deviceId,
            name: `openclaw-agent-${this.deviceId.slice(0, 8)}`,
            type: "node",
            platform: "linux"
          }
        },
      });

      return;
    }

    // 2) Connect response -> mark ready or detect pairing requirement
    if (msg.type === "res" && msg.id === "c1") {
      if (msg.ok) {
        this.ready = true;
        this.pairingRequired = false;
        console.log("[gateway] Connected successfully");
      } else {
        // Check if pairing is required
        const errorMsg = msg.error?.message || "";
        if (errorMsg.includes("pairing") || errorMsg.includes("1008")) {
          this.pairingRequired = true;
          console.warn(`[gateway] Device pairing required for device ID: ${this.deviceId}`);
          console.warn(`[gateway] Approve device via: openclaw devices list && openclaw devices approve <requestId>`);
        }
      }
      return;
    }

    // 3) Chat streaming events
    if (msg.type === "event" && msg.event === "chat") {
      const p = msg.payload || {};
      
      const pending = this.pending.get(this.lastChatReqId);
      if (!pending) return;

      // Extract text from message.content array
      if (p.message?.content) {
        const text = (p.message.content || [])
          .filter(c => c.type === "text")
          .map(c => c.text)
          .join("");
        
        // For delta state, accumulate chunks
        if (p.state === "delta" && text) {
          pending.chunks.push(text);
          return;
        }
        
        // For final state, resolve with the complete message
        if (p.state === "final") {
          // Use final text directly (it contains the full response)
          pending.resolve(text || pending.chunks.join(""));
          this.pending.delete(this.lastChatReqId);
          this.lastChatReqId = null;
          return;
        }
      }
      return;
    }

    // 4) Any response to a pending request id
    if (msg.type === "res" && msg.id && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id);

      if (msg.ok) {
        // Some servers return immediate info here (like turnId/chatId)
        pending.meta = msg.payload || msg.result || null;
        // DO NOT resolve yet; streaming may come via events.
        // But if server returns a direct text, resolve.
        const payload = msg.payload || msg.result || {};
        if (typeof payload?.text === "string") {
          pending.resolve(payload.text);
          this.pending.delete(msg.id);
        }
      } else {
        console.error("[gateway] req failed:", msg.error);
        pending.reject(new Error(msg.error?.message || "gateway request failed"));
        this.pending.delete(msg.id);
      }
      return;
    }

    // 5) Errors
    if (msg.type === "res" && msg.ok === false && msg.id) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        pending.reject(new Error(msg.error?.message || "gateway request failed"));
        this.pending.delete(msg.id);
      }
    }
  }

  async sendChat({ agentId = "main", sessionKey, text }) {
    await this.connect();

    const reqId = `m${this.messageId++}`;
    this.lastChatReqId = reqId;

    // Promise that resolves when "done"
    const p = new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject, chunks: [] });
      // safety timeout
      setTimeout(() => {
        if (this.pending.has(reqId)) {
          this.pending.get(reqId).reject(new Error("chat timeout"));
          this.pending.delete(reqId);
        }
      }, 60_000);
    });

    // Encode agent into the sessionKey (since chat.send doesn't accept agentId)
    const sk = sessionKey || `agent:${agentId}:main`;

    // REQUIRED for side-effecting methods like chat.send
    const idempotencyKey = crypto.randomUUID();

    this._send({
      type: "req",
      id: reqId,
      method: "chat.send",
      params: {
        sessionKey: sk,
        message: text,               // MUST be a string
        idempotencyKey,              // REQUIRED
      },
    });

    return p;
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.ready = false;
  }
}
