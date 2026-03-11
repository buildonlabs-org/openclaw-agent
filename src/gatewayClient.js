// gatewayClient.js
import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function deviceIdFromRawPublicKey(rawPk) {
  return crypto.createHash("sha256").update(rawPk).digest("hex");
}

// Build the v2 pipe-delimited payload that must be signed with the device's Ed25519 key
function buildDeviceAuthPayloadV2({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce }) {
  const scopesStr = scopes.join(",");
  return `v2|${deviceId}|${clientId}|${clientMode}|${role}|${scopesStr}|${signedAtMs}|${token}|${nonce}`;
}

// Load or generate a persistent device key pair for this client.
// Keys are stored in STATE_DIR so they persist across restarts and reconnections.
// This ensures the gateway sees the same device ID and won't require re-pairing.
function loadOrGenerateDeviceKeys() {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || "/data/.openclaw";
  const keyPath = path.join(stateDir, "gateway-client-device.key");

  try {
    // Try to load existing key
    if (fs.existsSync(keyPath)) {
      const keyData = JSON.parse(fs.readFileSync(keyPath, "utf8"));
      const privateKey = crypto.createPrivateKey({
        key: Buffer.from(keyData.privateKey, "base64"),
        format: "der",
        type: "pkcs8",
      });
      const publicKey = crypto.createPublicKey(privateKey);
      const spkiDer = publicKey.export({ type: "spki", format: "der" });
      const rawPublicKey = spkiDer.subarray(spkiDer.length - 32);
      const deviceId = deviceIdFromRawPublicKey(rawPublicKey);
      
      console.log(`[gateway-client] loaded device key: ${deviceId.slice(0, 12)}...`);
      return { privateKey, rawPublicKey, deviceId };
    }
  } catch (err) {
    console.warn(`[gateway-client] failed to load device key: ${err.message}`);
  }

  // Generate new key pair
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = spkiDer.subarray(spkiDer.length - 32);
  const deviceId = deviceIdFromRawPublicKey(rawPublicKey);

  // Save for future use
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const pkcs8Der = privateKey.export({ type: "pkcs8", format: "der" });
    fs.writeFileSync(keyPath, JSON.stringify({
      privateKey: pkcs8Der.toString("base64"),
      deviceId,
    }));
    console.log(`[gateway-client] generated new device key: ${deviceId.slice(0, 12)}...`);
  } catch (err) {
    console.warn(`[gateway-client] failed to save device key: ${err.message}`);
  }

  return { privateKey, rawPublicKey, deviceId };
}

export class OpenClawGatewayClient {
  constructor({ gatewayUrl, token, skipDeviceAuth = false }) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
    this.skipDeviceAuth = skipDeviceAuth; // Skip device authentication for API clients

    if (!skipDeviceAuth) {
      // Load or generate a persistent device key pair.
      // This ensures the same device ID is used across reconnections,
      // so the gateway won't require repeated pairing approvals.
      const deviceKeys = loadOrGenerateDeviceKeys();
      this._privateKey = deviceKeys.privateKey;
      this._rawPublicKey = deviceKeys.rawPublicKey;
      this._deviceId = deviceKeys.deviceId;
    } else {
      console.log("[gateway-client] device auth disabled for API client");
      this._privateKey = null;
      this._rawPublicKey = null;
      this._deviceId = null;
    }

    this.ws = null;
    this.ready = false;
    this.connectError = null; // Set when connect is rejected by the gateway
    this.pending = new Map(); // reqId -> { resolve, reject, chunks, done }
    this.messageId = 1;
    this.lastChatReqId = null; // Track latest chat request for event routing
  }

  async connect() {
    if (this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) return;

    // If a prior socket exists, close it
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    this.ready = false;
    this.connectError = null;

    this.ws = new WebSocket(this.gatewayUrl);

    this.ws.on("message", (data) => this._onMessage(data));
    this.ws.on("close", () => {
      this.ready = false;
      // fail all pending
      for (const [id, p] of this.pending.entries()) {
        p.reject(new Error("gateway connection closed"));
        this.pending.delete(id);
      }
    });
    this.ws.on("error", (err) => {
      this.ready = false;
      if (!this.connectError) {
        this.connectError = err;
      }
      // Also reject any requests that are already pending
      for (const [id, p] of this.pending.entries()) {
        p.reject(err);
        this.pending.delete(id);
      }
    });

    // Wait until ready or an error is received
    const start = Date.now();
    while (!this.ready) {
      if (this.connectError) throw this.connectError;
      if (Date.now() - start > 10_000) throw new Error("Gateway connect timeout");
      await sleep(50);
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

    // 1) Challenge -> send connect with device authentication
    if (msg.type === "event" && msg.event === "connect.challenge") {
      const nonce = msg.payload?.nonce;
      const signedAt = Date.now();
      const clientId = "cli";
      const clientMode = "cli";
      const role = "operator";
      const scopes = ["operator.read", "operator.write", "operator.admin"];

      const connectParams = {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: clientId, version: "1.0.0", platform: "linux", mode: clientMode },
        role,
        scopes,
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: this.token },
        locale: "en-US",
        userAgent: "backend-gateway-client",
      };

      // Include signed device payload when the gateway issues a nonce challenge,
      // UNLESS skipDeviceAuth is enabled (for API/backend clients that trust token-only auth).
      if (nonce && !this.skipDeviceAuth && this._deviceId) {
        const payload = buildDeviceAuthPayloadV2({
          deviceId: this._deviceId,
          clientId,
          clientMode,
          role,
          scopes,
          signedAtMs: signedAt,
          token: this.token,
          nonce,
        });
        const signature = crypto.sign(null, Buffer.from(payload, "utf8"), this._privateKey);
        connectParams.device = {
          id: this._deviceId,
          publicKey: this._rawPublicKey.toString("base64"),
          signature: signature.toString("base64"),
          signedAt,
          nonce,
        };
        console.log("[gateway-client] sending device auth with id:", this._deviceId.slice(0, 12) + "...");
      } else if (nonce && this.skipDeviceAuth) {
        console.log("[gateway-client] skipping device auth (token-only mode)");
      }

      this._send({
        type: "req",
        id: "c1",
        method: "connect",
        params: connectParams,
      });

      return;
    }

    // 2) Connect response -> mark ready or store error for immediate propagation
    if (msg.type === "res" && msg.id === "c1") {
      if (msg.ok) {
        this.ready = true;
      } else {
        this.connectError = new Error(
          msg.error?.message || "Gateway connection rejected (pairing required)"
        );
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
    this.connectError = null;
  }
}
