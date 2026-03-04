FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN cat > /usr/local/bin/entrypoint-api.sh <<'EOF'
#!/bin/sh
set -eu

echo "[boot] service=api node=$(node --version) model=claude-3-haiku-20240307"

exec "$@"
EOF

RUN cat > /usr/local/bin/entrypoint-worker.sh <<'EOF'
#!/bin/sh
set -eu

echo "[boot] service=worker node=$(node --version) model=claude-3-haiku-20240307 poll_ms=${REPORT_PROCESSOR_POLL_MS:-5000}"

exec "$@"
EOF

RUN chmod +x /usr/local/bin/entrypoint-api.sh /usr/local/bin/entrypoint-worker.sh \
  && chown -R node:node /app /usr/local/bin/entrypoint-api.sh /usr/local/bin/entrypoint-worker.sh

USER node
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint-api.sh"]
CMD ["node", "dist/server.js"]
