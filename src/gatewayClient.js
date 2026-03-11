// gatewayClient.js
import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";
import path from "path";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class OpenClawGatewayClient {
  constructor({ gatewayUrl, token, keyPath }) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
    this.keyPath = keyPath;

    // Load or generate device identity
    this._loadOrGenerateDeviceIdentity();

    // ADDED - Track connection states
    this.ws = null;
    this.ready = false;
    this.pairingRequired = false; // Track pairing state
    this.connectError = null; // Store connection errors
    this.pending = new Map(); // reqId -> { resolve, reject, chunks, done }
    this.messageId = 1;
    this.lastChatReqId = null; // Track latest chat request for event routing
  }

  _loadOrGenerateDeviceIdentity() {
    let deviceData = null;

    // Try to load existing device identity
    if (this.keyPath && fs.existsSync(this.keyPath)) {
      try {
        const fileContent = fs.readFileSync(this.keyPath, "utf8");
        deviceData = JSON.parse(fileContent);
        console.log("[gateway-client] loaded persistent device identity");
      } catch (err) {
        console.warn("[gateway-client] failed to load device identity, generating new one:", err.message);
      }
    }

    // Generate new identity if needed
    if (!deviceData) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const spkiDer = publicKey.export({ type: "spki", format: "der" });
      const rawPublicKey = spkiDer.subarray(spkiDer.length - 32);
      const rawPublicKeyB64 = rawPublicKey.toString("base64");
      const deviceId = crypto.createHash("sha256").update(rawPublicKey).digest("hex");

      deviceData = {
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
        publicKey: rawPublicKeyB64,
        deviceId
      };

      // Save to file if keyPath provided
      if (this.keyPath) {
        try {
          const dir = path.dirname(this.keyPath);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(this.keyPath, JSON.stringify(deviceData, null, 2), "utf8");
          console.log("[gateway-client] saved device identity to", this.keyPath);
        } catch (err) {
          console.warn("[gateway-client] failed to save device identity:", err.message);
        }
      }
    }

    // Import keys
    this.privateKey = crypto.createPrivateKey({
      key: deviceData.privateKey,
      format: "pem",
      type: "pkcs8"
    });

    this.rawPublicKeyB64 = deviceData.publicKey;
    this.deviceId = deviceData.deviceId;
    this.rawPublicKey = Buffer.from(this.rawPublicKeyB64, "base64");

    console.log("[gateway-client] device ID:", this.deviceId);
  }

  buildDeviceAuthPayloadV2({ nonce, signedAtMs, clientId, clientMode, role, scopes }) {
    const scopesStr = scopes.join(",");
    return `v2|${this.deviceId}|${clientId}|${clientMode}|${role}|${scopesStr}|${signedAtMs}|${this.token}|${nonce}`;
  }

  async connect() {
    if (this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) return;

    // If a prior socket exists, close it
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    this.ready = false;
    this.pairingRequired = false;
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
    this.ws.on("error", () => {
      this.ready = false;
    });

    // Wait until ready or error
    const start = Date.now();
    while (!this.ready && !this.pairingRequired && !this.connectError) {
      if (Date.now() - start > 15_000) throw new Error("Gateway connect timeout");
      await sleep(50);
    }

    // Throw appropriate error if connection failed
    if (this.pairingRequired) {
      throw new Error("pairing required");
    }
    if (this.connectError) {
      throw new Error(`Gateway connect failed: ${this.connectError}`);
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

    // 1) Challenge -> send signed connect with device authentication
    if (msg.type === "event" && msg.event === "connect.challenge") {
      const nonce = msg.payload?.nonce;
      const signedAt = Date.now();

      const clientId = "cli";
      const clientMode = "cli";
      const role = "operator";
      const scopes = ["operator.read", "operator.write", "operator.admin"];

      const payload = this.buildDeviceAuthPayloadV2({
        nonce,
        signedAtMs: signedAt,
        clientId,
        clientMode,
        role,
        scopes,
      });

      const signature = crypto.sign(null, Buffer.from(payload, "utf8"), this.privateKey);

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
          locale: "en-US",
          userAgent: "backend-gateway-client",
          device: {
            id: this.deviceId,
            publicKey: this.rawPublicKeyB64,
            signature: signature.toString("base64"),
            signedAt,
            nonce,
          },
        },
      });

      return;
    }

    // 2) Connect response -> mark ready or handle pairing
    if (msg.type === "res" && msg.id === "c1") {
      if (msg.ok) {
        this.ready = true;
      } else if (msg.error?.code === "NOT_PAIRED" || msg.error?.details?.code === "PAIRING_REQUIRED") {
        // Handle pairing requirement from connect response
        this.pairingRequired = true;
        console.log("[gateway-client] pairing required for device:", this.deviceId);
        if (this.onPairingRequired) {
          console.log("[gateway-client] triggering pairing callback...");
          // Trigger callback asynchronously, don't block message processing
          Promise.resolve().then(() => this.onPairingRequired(this.deviceId, msg.error?.details?.requestId));
        }
      } else {
        // Other error
        this.connectError = msg.error?.message || JSON.stringify(msg.error);
      }
      return;
    }

    // 2b) Device pairing requested event (alternative path)
    if (msg.type === "event" && msg.event === "device.pair.requested") {
      this.pairingRequired = true;
      console.log("[gateway-client] device pairing requested via event:", this.deviceId);
      if (this.onPairingRequired) {
        Promise.resolve().then(() => this.onPairingRequired(this.deviceId));
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
