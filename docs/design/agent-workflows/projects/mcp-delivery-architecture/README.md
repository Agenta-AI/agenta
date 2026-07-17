# mcp-delivery-architecture

Research + direction options for one question: **how do tools reach an MCP-client harness
(Claude today, Codex tomorrow) across sandbox backends**, covering both

1. **our own tools** (gateway/Composio, code, client tools — the "agenta-tools" channel), which
   today reach Claude only when everything runs locally, and get silently dropped on Daytona; and
2. **external / user-declared MCP servers** (`mcp_servers` config), which today are flag-gated off
   (`AGENTA_AGENT_MCPS_ENABLED=false` by default), http-only, and non-Pi-only.

This project sits one level above [`../claude-daytona-tools/`](../claude-daytona-tools/README.md),
which designed (design-only, not implemented) the narrow fix for "our tools on Daytona." This doc
reuses that work as the short-term answer and asks the longer-term architecture question: what
single delivery model serves any harness, on any backend, for both our tools and external MCP
servers.

## Files

- [`directions.md`](./directions.md) — current-state synthesis (with `file:line` refs) and the
  short-term / long-term solution directions, with a recommendation.

## Status

RESEARCH + DIRECTIONS ONLY — awaiting owner review. No code changed.
