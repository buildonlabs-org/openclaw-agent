// gatewayClient.js
import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Device key persistence helpers
function getDeviceKeyPath(stateDir) {
  return path.join(stateDir, "device-key.pem");
}

function loadOrGenerateDeviceKey(stateDir) {
  const keyPath = getDeviceKeyPath(stateDir);
  
  try {
    // Try loading existing key
    if (fs.existsSync(keyPath)) {
      const keyData = fs.readFileSync(keyPath, 'utf8');
      const privateKey = crypto.createPrivateKey({
        key: keyData,
        format: 'pem',
        type: 'pkcs8'
      });
      const publicKey = crypto.createPublicKey(privateKey);
      console.log('[gateway] Loaded existing device key');
      return { publicKey, privateKey };
    }
  } catch (err) {
    console.warn('[gateway] Failed to load device key, generating new one:', err.message);
  }
  
  // Generate new Ed25519 keypair
  console.log('[gateway] Generating new Ed25519 device keypair...');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  
  // Save private key
  try {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });
    console.log('[gateway] Saved device key to', keyPath);
  } catch (err) {
    console.warn('[gateway] Failed to save device key:', err.message);
  }
  
  return { publicKey, privateKey };
}

function deviceIdFromRawPublicKey(rawPk) {
  return crypto.createHash('sha256').update(rawPk).digest('hex');
}

function buildDeviceAuthPayloadV2({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce }) {
  const scopesStr = scopes.join(',');
  return `v2|${deviceId}|${clientId}|${clientMode}|${role}|${scopesStr}|${signedAtMs}|${token}|${nonce}`;
}

export class OpenClawGatewayClient {
  constructor({ gatewayUrl, token, stateDir }) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
    this.stateDir = stateDir || process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");

    // Load or generate device keys
    const { publicKey, privateKey } = loadOrGenerateDeviceKey(this.stateDir);
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    
    // Extract raw Ed25519 public key (last 32 bytes of SPKI DER)
    const publicKeySpkiDer = publicKey.export({ type: 'spki', format: 'der' });
    this.rawPublicKey = publicKeySpkiDer.subarray(publicKeySpkiDer.length - 32);
    this.rawPublicKeyB64 = this.rawPublicKey.toString('base64');
    this.deviceId = deviceIdFromRawPublicKey(this.rawPublicKey);
    
    console.log('[gateway] Device ID:', this.deviceId);

    this.ws = null;
    this.ready = false;
    this.pending = new Map(); // reqId -> { resolve, reject, chunks, done }
    this.messageId = 1;
    this.lastChatReqId = null; // Track latest chat request for event routing
    this.pairingRequired = false; // Track if device pairing is needed
  }

  async connect() {
    if (this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) return;

    // Retry logic for device pairing
    const maxRetries = 12; // 12 retries = up to 60 seconds for pairing
    let attempt = 0;
    
    while (attempt < maxRetries) {
      attempt++;
      
      // If a prior socket exists, close it
      if (this.ws) {
        try { this.ws.close(); } catch {}
      }

      this.ready = false;
      this.pairingRequired = false;
      
      if (attempt === 1) {
        console.log(`[gateway] Connecting to Gateway with device ID ${this.deviceId.substring(0, 12)}...`);
      } else {
        console.log(`[gateway] Retry ${attempt}/${maxRetries} - reconnecting after pairing...`);
      }

      this.ws = new WebSocket(this.gatewayUrl);

      this.ws.on("open", () => {
        console.log(`[gateway] WebSocket connection opened, waiting for challenge...`);
      });

      this.ws.on("message", (data) => this._onMessage(data));
      
      this.ws.on("close", (code, reason) => {
        const reasonStr = reason?.toString() || "";
        this.ready = false;
        
        if (code !== 1000) {
          console.warn(`[gateway] Connection closed - Code: ${code}, Reason: ${reasonStr || '(none)'}`);
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

      // Wait until ready or pairing required
      const start = Date.now();
      const attemptTimeout = 8000; // 8 seconds per attempt
      
      while (!this.ready && !this.pairingRequired) {
        if (Date.now() - start > attemptTimeout) {
          console.error(`[gateway] Connection attempt ${attempt} timeout after ${attemptTimeout}ms`);
          break;
        }
        await sleep(50);
      }
      
      // If connected successfully, we're done
      if (this.ready) {
        console.log(`[gateway] ✓ Connected successfully`);
        return;
      }
      
      // If pairing is required and we still have retries, wait and retry
      if (this.pairingRequired && attempt < maxRetries) {
        console.log(`[gateway] Waiting 5s for auto-approval before retry...`);
        await sleep(5000);
        continue;
      }
      
      // If we exhausted retries or other error, fail
      if (attempt >= maxRetries) {
        throw new Error("Gateway connect timeout - device pairing may be required");
      }
    }
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

    // 1) Challenge -> send signed connect WITH device pairing for proper scopes
    if (msg.type === "event" && msg.event === "connect.challenge") {
      console.log(`[gateway] Received challenge, signing with device key`);
      
      const nonce = msg.payload?.nonce;
      if (!nonce) {
        console.error('[gateway] Missing nonce in challenge');
        return;
      }
      
      const signedAt = Date.now();
      const clientId = 'cli';
      const clientMode = 'cli';
      const role = 'operator';
      const scopes = ['operator.read', 'operator.write', 'operator.admin'];
      
      // Build v2 payload for signature
      const payload = buildDeviceAuthPayloadV2({
        deviceId: this.deviceId,
        clientId,
        clientMode,
        role,
        scopes,
        signedAtMs: signedAt,
        token: this.token,
        nonce,
      });
      
      // Sign with Ed25519 private key
      const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), this.privateKey);
      
      this._send({
        type: "req",
        id: "c1",
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: clientId, version: "1.0.0", platform: "linux", mode: clientMode },
          role,
          scopes,
          caps: [],
          commands: [],
          permissions: {},
          auth: { token: this.token },
          device: {
            id: this.deviceId,
            publicKey: this.rawPublicKeyB64,
            signature: signature.toString('base64'),
            signedAt,
            nonce,
          },
          locale: "en-US",
          userAgent: "backend-gateway-client",
        },
      });

      return;
    }

    // 2) Connect response -> mark ready or detect pairing requirement
    if (msg.type === "res" && msg.id === "c1") {
      if (msg.ok) {
        this.ready = true;
        this.pairingRequired = false;
        console.log("[gateway] Connected successfully with device pairing");
      } else {
        // Log connection error
        const errorMsg = msg.error?.message || "Unknown error";
        console.error(`[gateway] Connection failed: ${errorMsg}`);
        
        // Check if it's a pairing requirement
        if (errorMsg.includes('pairing required') || errorMsg.includes('not paired')) {
          this.pairingRequired = true;
          console.warn('[gateway] ⚠️  Device pairing required - waiting for auto-approval...');
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
