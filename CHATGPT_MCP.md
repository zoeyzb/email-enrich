# ChatGPT local MCP

This branch keeps the enrichment library intact and adds a small stdio MCP adapter.

## Tools

- `email_enrich_find` — public-page discovery, pattern inference, and optional SMTP verification.
- `email_enrich_harvest_domain` — only return emails actually published on the company's public site.

No Apollo, Hunter, or other paid data API is required by this repo.

## Mac quick start

```bash
git checkout chatgpt-mcp-local
chmod +x scripts/start-chatgpt-mcp.sh
./scripts/start-chatgpt-mcp.sh
```

The script builds the package and exposes the stdio MCP through Supergateway at:

```
http://127.0.0.1:8766/mcp
```

To use it from ChatGPT web while keeping it on your Mac, connect that local endpoint through OpenAI Secure MCP Tunnel.
