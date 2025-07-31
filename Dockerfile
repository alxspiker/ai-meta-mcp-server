# Multi-stage build for ai-meta-mcp-server
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Production stage
FROM node:18-alpine AS runtime

# Create non-root user for security
RUN addgroup -g 1001 -S mcpuser && \
    adduser -S mcpuser -u 1001 -G mcpuser

# Set working directory
WORKDIR /app

# Copy built application and dependencies from builder stage
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create directory for tools persistence with proper permissions
RUN mkdir -p /app/data && chown -R mcpuser:mcpuser /app

# Switch to non-root user
USER mcpuser

# Set environment variables with secure defaults
ENV NODE_ENV=production
ENV ALLOW_JS_EXECUTION=true
ENV ALLOW_PYTHON_EXECUTION=false
ENV ALLOW_SHELL_EXECUTION=false
ENV PERSIST_TOOLS=true
ENV TOOLS_DB_PATH=/app/data/tools.json

# Set the entry point
ENTRYPOINT ["node", "build/index.js"]