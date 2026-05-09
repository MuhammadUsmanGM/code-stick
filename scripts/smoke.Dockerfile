# Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
#
# End-to-end smoke for code-stick on Linux x64. Build + run with:
#
#   docker build -f scripts/smoke.Dockerfile -t code-stick-smoke .
#   docker run --rm code-stick-smoke
#
# The container needs network egress to github.com / ollama.com to pull the
# Ollama + opencode + phi3-mini blobs. Smoke fails closed if either is blocked.

FROM node:20-bookworm-slim

# ca-certificates: TLS validation for downloads.
# curl, ripgrep: convenient for debugging when smoke fails.
# tar, xz-utils, unzip: required by node-tar / extract-zip for the upstream
# archive formats we ingest. xz is in the base; xz-utils ensures the binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl tar xz-utils unzip git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /code-stick
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# tsup outputs to dist/cli.js — the smoke runner does the build itself, but
# pre-warming here surfaces typescript errors at image-build time rather than
# at run time.
RUN npm run typecheck && npm run build

ENV SMOKE_USB=/tmp/usb \
    SMOKE_MODEL=phi3-mini

CMD ["node", "scripts/smoke.mjs"]
