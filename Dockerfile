# Mishwark: API + dashboard in one image (linux/amd64 and linux/arm64).
#
#   docker build -t mishwark .
#
# The container applies any missing migrations, then starts the API, which also
# serves the dashboard at /dashboard/. Uploaded files live in two volumes:
#   /app/backend/storage   drivers' papers (private)
#   /app/backend/uploads   car and team photos

# ---- dashboard build -------------------------------------------------------
FROM node:22-bookworm-slim AS dashboard
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- API build ---------------------------------------------------------------
FROM node:22-bookworm-slim AS api
# Compilers only in case a native module (bcrypt) has no prebuilt binary for
# this CPU; they stay in this stage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/ ./
# prisma generate reads the config, which expects a DATABASE_URL; any value works here.
RUN DATABASE_URL=postgresql://build@localhost/build npx prisma generate && npm run build

# ---- runtime -----------------------------------------------------------------
FROM node:22-bookworm-slim
# The git commit being built; /api/v1/health reports it.
ARG APP_VERSION=dev
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=5000 \
    DASHBOARD_DIST=/app/frontend/dist \
    DRIVER_DOCUMENTS_DIR=/app/backend/storage/driver-documents \
    BUSINESS_TZ=Africa/Cairo \
    APP_VERSION=${APP_VERSION}
WORKDIR /app/backend
# node_modules stays complete: tsx runs the migration and first-start scripts.
COPY --from=api --chown=node:node /app/backend ./
COPY --from=dashboard --chown=node:node /app/frontend/dist /app/frontend/dist
RUN mkdir -p storage/driver-documents uploads/vehicles uploads/employees \
 && chown -R node:node storage uploads
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx tsx prisma/migrate.ts && exec node dist/src/index.js"]
