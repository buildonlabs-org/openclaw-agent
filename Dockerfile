# OpenClaw Gateway on Railway
# This Dockerfile creates a minimal container for running the OpenClaw gateway

FROM node:22-slim

# Install dependencies for OpenClaw
RUN apt-get update && apt-get install -y \
    curl \
    bash \
    ca-certificates \
    git \
    build-essential \
    python3 \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw CLI using the installer in non-interactive mode
# Set environment variables to skip interactive prompts
ENV OPENCLAW_SKIP_SETUP=1 \
    DEBIAN_FRONTEND=noninteractive \
    CI=true

RUN curl -fsSL https://openclaw.ai/install.sh | bash || \
    (echo "Installer may have failed on setup, checking if binary exists..." && which openclaw)

# Add common OpenClaw installation paths to PATH
ENV PATH="/root/.local/bin:/root/.openclaw/bin:${PATH}"

# Verify OpenClaw is installed and working
RUN openclaw --version

# Create workspace directory
RUN mkdir -p /data/workspace

# Set default workspace location
ENV OPENCLAW_WORKSPACE=/data/workspace

# Copy runtime files
COPY start.sh /start.sh
COPY health.js /health.js

# Make start script executable
RUN chmod +x /start.sh

# Expose port (Railway will override with PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Run the startup script
ENTRYPOINT ["/start.sh"]
