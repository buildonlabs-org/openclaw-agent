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
    this.onPairingRequired = null; // Callback for pairing events

    // Load or generate persistent device keypair
    let publicKey, privateKey;
    
    if (keyPath && fs.existsSync(keyPath)) {
      // Load existing keypair
      try {
        const keyData = JSON.parse(fs.readFileSync(keyPath, "utf8"));
        privateKey = crypto.createPrivateKey({
          key: Buffer.from(keyData.privateKey, "base64"),
          format: "der",
          type: "pkcs8"
        });
        publicKey = crypto.createPublicKey(privateKey);
        console.log("[gateway-client] loaded persistent device identity");
      } catch (err) {
        console.log(`[gateway-client] failed to load keys, generating new: ${err.message}`);
        ({ publicKey, privateKey } = crypto.generateKeyPairSync("ed25519"));
      }
    } else {
      // Generate new keypair
      ({ publicKey, privateKey } = crypto.generateKeyPairSync("ed25519"));
    }

    this.privateKey = privateKey;

    // Persist keys if path provided
    if (keyPath && !fs.existsSync(keyPath)) {
      try {
        const keyDir = path.dirname(keyPath);
        fs.mkdirSync(keyDir, { recursive: true });
        
        const keyData = {
          privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
          created: new Date().toISOString()
        };
        fs.writeFileSync(keyPath, JSON.stringify(keyData), "utf8");
        console.log(`[gateway-client] saved device identity to ${keyPath}`);
      } catch (err) {
        console.error(`[gateway-client] failed to save keys: ${err.message}`);
      }
    }

    const spkiDer = publicKey.export({ type: "spki", format: "der" });
    this.rawPublicKey = spkiDer.subarray(spkiDer.length - 32);
    this.rawPublicKeyB64 = this.rawPublicKey.toString("base64");
    this.deviceId = crypto.createHash("sha256").update(this.rawPublicKey).digest("hex");

    console.log(`[gateway-client] device ID: ${this.deviceId}`);

    this.ws = null;
    this.ready = false;
    this.pending = new Map(); // reqId -> { resolve, reject, chunks, done }
    this.messageId = 1;
    this.lastChatReqId = null; // Track latest chat request for event routing
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

    // Wait until ready
    const start = Date.now();
    while (!this.ready) {
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

    // 1) Challenge -> send signed connect
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
          client: { id: clientId, version: "0.0.0", platform: "linux", mode: clientMode },
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

    // 2) Connect response -> mark ready
    if (msg.type === "res" && msg.id === "c1") {
      if (msg.ok) this.ready = true;
      return;
    }

    // 2b) Device pairing requested event
    if (msg.type === "event" && msg.event === "device.pair.requested") {
      console.log("[gateway-client] device pairing requested:", this.deviceId);
      if (this.onPairingRequired) {
        this.onPairingRequired(this.deviceId);
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
