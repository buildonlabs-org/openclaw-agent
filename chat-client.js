#!/usr/bin/env node

import WebSocket from 'ws';
import crypto from 'crypto';
import readline from 'readline';

// Configuration
const GATEWAY_TOKEN = '7a0f0dd87107e05d359a4b56399ef46a5677dd95303cd2a8eb406330ca8ff177';
const GATEWAY_URL = `ws://localhost:8080/gateway?token=${GATEWAY_TOKEN}`;

// Generate keypair as KeyObjects (better for signing/export)
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

// Export SPKI DER and extract last 32 bytes as raw Ed25519 public key
const publicKeySpkiDer = publicKey.export({ type: 'spki', format: 'der' });
const rawPublicKey = publicKeySpkiDer.subarray(publicKeySpkiDer.length - 32); // 32 bytes
const rawPublicKeyB64 = rawPublicKey.toString('base64');

let messageId = 1;
let authenticated = false;

const ws = new WebSocket(GATEWAY_URL);

ws.on('open', () => {
  console.log('✓ Connected to gateway');
  console.log('⏳ Waiting for challenge...');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('\n← Received:', JSON.stringify(msg, null, 2));

  // Handle connect challenge
  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    console.log('\n🔐 Received challenge, signing...');
    handleChallenge(msg.payload.nonce);
  }

  // Handle successful connection
  if (msg.type === 'res' && msg.id === 'c1' && msg.ok !== false) {
    console.log('\n✓ Authentication successful!');
    console.log('💬 You can now send messages. Type your message and press Enter:');
    authenticated = true;
    startChatInterface();
  }

  // Handle agent responses
  if (msg.type === 'event' && msg.event === 'operator.message') {
    const message = msg.payload;
    if (message.role === 'assistant') {
      console.log(`\n🤖 Agent: ${message.content.text || JSON.stringify(message.content)}`);
    }
  }

  // Handle errors
  if (msg.type === 'res' && msg.error) {
    console.error('\n❌ Error:', msg.error);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('\n✗ Connection closed');
  process.exit(0);
});

function deviceIdFromRawPublicKey(rawPk) {
  return crypto.createHash('sha256').update(rawPk).digest('hex');
}

// IMPORTANT: payload format (pipe-delimited) from OpenClaw v2 protocol
function buildDeviceAuthPayloadV2({
  deviceId,
  clientId,
  clientMode,
  role,
  scopes,      // array of strings
  signedAtMs,
  token,
  nonce,
}) {
  const scopesStr = scopes.join(','); // comma-separated
  return `v2|${deviceId}|${clientId}|${clientMode}|${role}|${scopesStr}|${signedAtMs}|${token}|${nonce}`;
}

function handleChallenge(nonce) {
  const signedAt = Date.now(); // integer ms

  const clientId = 'cli';
  const clientMode = 'cli';      // must match what your gateway accepts
  const role = 'operator';
  const scopes = ['operator.read', 'operator.write', 'operator.admin'];

  const deviceId = deviceIdFromRawPublicKey(rawPublicKey);

  const payload = buildDeviceAuthPayloadV2({
    deviceId,
    clientId,
    clientMode,
    role,
    scopes,
    signedAtMs: signedAt,
    token: GATEWAY_TOKEN,
    nonce,
  });

  // Sign UTF-8 payload with Ed25519
  const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey);

  const connectRequest = {
    type: "req",
    id: "c1",
    method: "connect",
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: "0.0.0",
        platform: "macos",
        mode: clientMode,
      },
      role,
      scopes,
      caps: [],
      commands: [],
      permissions: {},
      auth: { token: GATEWAY_TOKEN },
      locale: "en-US",
      userAgent: "chat-client",
      device: {
        id: deviceId,
        publicKey: rawPublicKeyB64,
        signature: signature.toString('base64'),
        signedAt,
        nonce,
      },
    },
  };

  console.log('\n→ Sending signed connect request...');
  ws.send(JSON.stringify(connectRequest));
}

function startChatInterface() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n> '
  });

  rl.prompt();

  rl.on('line', (line) => {
    const text = line.trim();
    
    if (!text) {
      rl.prompt();
      return;
    }

    if (text === '/quit' || text === '/exit') {
      console.log('👋 Goodbye!');
      ws.close();
      process.exit(0);
    }

    sendMessage(text);
    rl.prompt();
  });
}

function sendMessage(text) {
  const msg = {
    type: "req",
    id: `m${messageId++}`,
    method: "operator.message.send",
    params: {
      content: { text },
      role: "user"
    }
  };

  console.log(`\n→ You: ${text}`);
  ws.send(JSON.stringify(msg));
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Goodbye!');
  ws.close();
  process.exit(0);
});
