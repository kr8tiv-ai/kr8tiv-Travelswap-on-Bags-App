# ── Stage 1: Builder ─────────────────────────────────────────────
# Installs all dependencies, builds frontend + backend
FROM node:22-slim AS builder

WORKDIR /app

# Root package files (installs root deps: pg, @duffel/api, fastify-plugin, etc.)
COPY package.json package-lock.json ./
RUN npm ci

# Frontend dependencies
COPY frontend/package.json frontend/package-lock.json* frontend/
RUN cd frontend && npm ci

# Backend dependencies
COPY backend/package.json backend/package-lock.json* backend/
RUN cd backend && npm ci

# Copy source files
COPY frontend/ frontend/
COPY backend/ backend/

# Build frontend (Vite → frontend/dist/)
RUN cd frontend && npm run build

# Build backend (TypeScript → backend/dist/)
RUN cd backend && npm run build


# ── Stage 2: Production ─────────────────────────────────────────
# Slim image with only compiled output + production dependencies
FROM node:22-slim

# Install curl for Docker health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Root production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Backend production dependencies
COPY backend/package.json backend/package-lock.json* backend/
RUN cd backend && npm ci --omit=dev

# Compiled backend from builder
COPY --from=builder /app/backend/dist/ backend/dist/

# Compiled frontend from builder
COPY --from=builder /app/frontend/dist/ frontend/dist/

# Non-root user for security
RUN addgroup --system appuser && adduser --system --ingroup appuser appuser
RUN chown -R appuser:appuser /app

# Runtime configuration
ENV NODE_ENV=production
ENV STATIC_DIR=/app/frontend/dist

EXPOSE 3001

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health/live || exit 1

CMD ["node", "backend/dist/main.js"]
