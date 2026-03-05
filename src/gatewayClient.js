// gatewayClient.js
import WebSocket from "ws";
import crypto from "crypto";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class OpenClawGatewayClient {
  constructor({ gatewayUrl, token }) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;

    this.ws = null;
    this.ready = false;
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

    // 1) Challenge -> send simplified connect (token-only, no device)
    if (msg.type === "event" && msg.event === "connect.challenge") {
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
          caps: ["terminal", "shell", "cli"],
          commands: ["clawhub", "openclaw", "npm", "node"],
          permissions: {
            "terminal:execute": true,
            "shell:execute": true,
            "cli:execute": true,
            "skills:install": true,
            "skills:update": true,
            "skills:remove": true,
          },
          auth: { token: this.token },
          locale: "en-US",
          userAgent: "backend-gateway-client",
          // Provide device info as backend-operator to bypass pairing
          device: {
            id: "backend-operator",
            name: "Backend API Server",
            type: "server",
            trusted: true,
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
