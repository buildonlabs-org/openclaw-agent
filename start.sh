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
    echo "The gateway may not function properly without it."
fi

# Show OpenClaw version
echo "OpenClaw version: $(openclaw --version 2>&1 || echo 'Unable to get version')"

# Show available commands
echo ""
echo "Checking OpenClaw gateway command..."
openclaw gateway --help > /tmp/gateway-help.txt 2>&1 || echo "Could not get gateway help"
if [ -f /tmp/gateway-help.txt ]; then
    echo "Gateway command available. Help output:"
    head -20 /tmp/gateway-help.txt
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
echo "✓ Gateway process started (PID: $GATEWAY_PID)"

# Wait for gateway to initialize and check if it's running
echo "Waiting for gateway to initialize..."
for i in {1..30}; do
    if ! kill -0 $GATEWAY_PID 2>/dev/null; then
        echo "❌ Gateway process died. Logs:"
        cat /tmp/openclaw-gateway.log
        exit 1
    fi
    
    # Check if the port is actually listening
    if curl -s http://127.0.0.1:$OPENCLAW_GATEWAY_PORT/health >/dev/null 2>&1; then
        echo "✓ Gateway is responding on port $OPENCLAW_GATEWAY_PORT"
        break
    fi
    
    if [ $i -eq 30 ]; then
        echo "❌ Gateway did not become ready in time. Logs:"
        cat /tmp/openclaw-gateway.log
        echo ""
        echo "Process status:"
        ps aux | grep openclaw || echo "No openclaw process found"
        exit 1
    fi
    
    sleep 1
done

# Start the health/proxy server (this becomes PID 1)
echo ""
echo "Starting health & proxy server on port $PORT..."
exec node /health.js
