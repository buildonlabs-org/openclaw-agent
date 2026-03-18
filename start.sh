#!/bin/bash

# OpenClaw Gateway Wrapper Startup Script for Railway
# The wrapper handles all gateway configuration and lifecycle management

set -e

# Set default port if not provided by Railway
export PORT="${PORT:-8080}"
export OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-/data/workspace}"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
export OPENCLAW_CLI="${OPENCLAW_CLI:-openclaw}"
export CLAWHUB_CLI="${CLAWHUB_CLI:-clawhub}"

# Auto-configure OpenAI defaults for all agents
# Set DEFAULT_OPENAI_API_KEY in Railway environment variables
if [ -n "$DEFAULT_OPENAI_API_KEY" ]; then
    export OPENAI_API_KEY="${OPENAI_API_KEY:-$DEFAULT_OPENAI_API_KEY}"
fi
export DEFAULT_MODEL="${DEFAULT_MODEL:-gpt-4o-mini}"

echo "=============================================="
echo "🚀 Starting OpenClaw Gateway Wrapper"
echo "=============================================="
echo "Port: $PORT"
echo "Workspace: $OPENCLAW_WORKSPACE"
echo "State Dir: $OPENCLAW_STATE_DIR"
echo "CLI: $OPENCLAW_CLI"
echo "ClawHub CLI: $CLAWHUB_CLI"
echo "Default Model: $DEFAULT_MODEL"
echo "=============================================="

# Ensure directories exist
mkdir -p "$OPENCLAW_WORKSPACE"
mkdir -p "$OPENCLAW_STATE_DIR"

# Verify OpenClaw CLI is available
if ! command -v "$OPENCLAW_CLI" &> /dev/null; then
    echo "❌ ERROR: OpenClaw CLI '$OPENCLAW_CLI' not found in PATH"
    echo "PATH: $PATH"
    exit 1
fi

echo "✓ OpenClaw CLI found: $(which "$OPENCLAW_CLI")"
# Check if ClawHub CLI is available
if command -v "$CLAWHUB_CLI" &> /dev/null; then
    echo "✓ ClawHub CLI found: $(which "$CLAWHUB_CLI")"
else
    echo "⚠️  ClawHub CLI not found - skill management features will be limited"
fi

# Install default skills if specified (only on first setup)
if [ -n "$OPENCLAW_DEFAULT_SKILLS" ] && [ ! -f "$OPENCLAW_STATE_DIR/.skills_initialized" ]; then
    echo ""
    echo "📦 Installing default skills..."
    
    # Set clawhub workdir to the workspace
    export CLAWHUB_WORKDIR="$OPENCLAW_WORKSPACE"
    
    # Split comma-separated skills and install each
    IFS=',' read -ra SKILLS <<< "$OPENCLAW_DEFAULT_SKILLS"
    for skill in "${SKILLS[@]}"; do
        skill=$(echo "$skill" | xargs)  # Trim whitespace
        if [ -n "$skill" ]; then
            echo "  Installing skill: $skill"
            if command -v "$CLAWHUB_CLI" &> /dev/null; then
                "$CLAWHUB_CLI" install "$skill" --no-input --force || echo "    ⚠️  Failed to install $skill"
            else
                echo "    ⚠️  ClawHub CLI not available, skipping"
                break
            fi
        fi
    done
    
    # Mark skills as initialized
    touch "$OPENCLAW_STATE_DIR/.skills_initialized"
    echo "✓ Default skills installation complete"
fi

# ho "✓ OpenClaw version: $("$OPENCLAW_CLI" --version 2>&1 || echo 'Unable to get version')"

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

