#!/bin/bash

# OpenClaw Gateway Wrapper Startup Script for Railway
# The wrapper handles all gateway configuration and lifecycle management

set -e

# Set default port if not provided by Railway
export PORT="${PORT:-8080}"
export OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-/data/workspace}"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
export OPENCLAW_ENTRY="${OPENCLAW_ENTRY:-/openclaw/dist/entry.js}"

echo "=============================================="
echo "🚀 Starting OpenClaw Gateway Wrapper"
echo "=============================================="
echo "Port: $PORT"
echo "Workspace: $OPENCLAW_WORKSPACE"
echo "State Dir: $OPENCLAW_STATE_DIR"
echo "Entry: $OPENCLAW_ENTRY"
echo "=============================================="

# Ensure directories exist
mkdir -p "$OPENCLAW_WORKSPACE"
mkdir -p "$OPENCLAW_STATE_DIR"

# Verify OpenClaw node module is available
if [ ! -f "$OPENCLAW_ENTRY" ]; then
    echo "❌ ERROR: OpenClaw entry.js not found at $OPENCLAW_ENTRY"
    echo "Available files in /openclaw:"
    ls -la /openclaw 2>/dev/null || echo "Directory not found"
    exit 1
fi

echo "✓ OpenClaw entry found: $OPENCLAW_ENTRY"
echo "✓ OpenClaw version: $(node "$OPENCLAW_ENTRY" --version 2>&1 || echo 'Unable to get version')"

# Verify SETUP_PASSWORD is set
if [ -z "$SETUP_PASSWORD" ]; then
    echo "⚠️  WARNING: SETUP_PASSWORD not set!"
    echo "Set SETUP_PASSWORD in Railway Variables to access /setup wizard"
fi

# Start the wrapper server (this handles gateway lifecycle)
echo ""
echo "Starting wrapper server on port $PORT..."
cd /app
exec node src/server.js

