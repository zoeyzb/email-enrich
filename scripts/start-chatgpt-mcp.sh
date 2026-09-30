#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm install
npm run build

echo "Email Enrich MCP: http://127.0.0.1:8766/mcp"
echo "Keep this terminal open."

exec npx -y supergateway \
  --stdio "node $ROOT/mcp/server.mjs" \
  --outputTransport streamableHttp \
  --port 8766 \
  --streamableHttpPath /mcp
