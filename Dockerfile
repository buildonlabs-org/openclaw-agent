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

# Install OpenClaw from npm (as node module)
# This creates /openclaw/dist/entry.js that we can run with node
WORKDIR /openclaw
RUN npm install -g openclaw@latest || \
    (echo "Installing from source..." && \
     git clone https://github.com/openchat-hq/openclaw.git . && \
     npm install && \
     npm run build)

# Verify OpenClaw is installed and can run
RUN node /openclaw/dist/entry.js --version || \
    (echo "Trying alternate path..." && ls -la /openclaw && find /openclaw -name "entry.js")

# Create workspace directory
RUN mkdir -p /data/workspace /data/.openclaw

# Set default workspace location
ENV OPENCLAW_WORKSPACE=/data/workspace
ENV OPENCLAW_STATE_DIR=/data/.openclaw
ENV OPENCLAW_ENTRY=/openclaw/dist/entry.js

# Set up Node wrapper application
WORKDIR /app

# Copy package files
COPY package.json /app/

# Install Node dependencies for wrapper
RUN npm install --production

# Copy wrapper source code
COPY src/ /app/src/

# Copy legacy health.js (backward compatibility)
COPY health.js /health.js

# Copy start script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Expose port (Railway will override with PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Run the startup script
ENTRYPOINT ["/start.sh"]
