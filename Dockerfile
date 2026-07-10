# syntax=docker/dockerfile:1

# ── Stage 1: build (all deps, compile TS) ──────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: production dependencies only ──────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Stage 3: runtime (distroless-ish, non-root) ────────────────────────────────
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

# Run as an unprivileged user.
RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app app

COPY --from=deps   /app/node_modules ./node_modules
COPY --from=builder /app/dist        ./dist
COPY package.json ./
COPY migrations ./migrations

USER app
EXPOSE 8080

# Liveness probe (used by orchestrators; overridable).
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Init to reap zombies + forward signals for graceful shutdown.
CMD ["node", "dist/index.js"]
