#!/bin/bash

# OpenClaw Gateway Startup Script for Railway
# This script runs both the health/proxy server and the OpenClaw gateway

set -e

# Set default port if not provided by Railway
export PORT="${PORT:-8080}"
export OPENCLAW_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
export OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-/data/workspace}"

echo "=============================================="
echo "🚀 Starting OpenClaw Gateway on Railway"
echo "=============================================="
echo "Public Port: $PORT"
echo "Gateway Port: $OPENCLAW_GATEWAY_PORT"
echo "Workspace: $OPENCLAW_WORKSPACE"
echo "=============================================="

# Ensure workspace directories exist
mkdir -p "$OPENCLAW_WORKSPACE"

# Verify OpenClaw is installed
if ! command -v openclaw &> /dev/null; then
    echo "❌ ERROR: OpenClaw CLI not found in PATH"
    echo "PATH: $PATH"
    exit 1
fi

echo "✓ OpenClaw CLI found: $(which openclaw)"

# Check required environment variables
if [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠️  WARNING: OPENAI_API_KEY not set"
fi

# Start OpenClaw gateway in the background
echo ""
echo "Starting OpenClaw gateway on port $OPENCLAW_GATEWAY_PORT..."
openclaw gateway \
    --port "$OPENCLAW_GATEWAY_PORT" \
    --host "127.0.0.1" \
    --workspace "$OPENCLAW_WORKSPACE" \
    > /tmp/openclaw-gateway.log 2>&1 &

GATEWAY_PID=$!
echo "✓ Gateway started (PID: $GATEWAY_PID)"

# Wait a moment for gateway to initialize
sleep 2

# Check if gateway is still running
if ! kill -0 $GATEWAY_PID 2>/dev/null; then
    echo "❌ Gateway failed to start. Logs:"
    cat /tmp/openclaw-gateway.log
    exit 1
fi

# Start the health/proxy server (this becomes PID 1)
echo ""
echo "Starting health & proxy server on port $PORT..."
exec node /health.js
