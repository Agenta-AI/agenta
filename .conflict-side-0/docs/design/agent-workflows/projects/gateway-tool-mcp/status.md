# Status

## State

DESIGN ONLY — awaiting author review. No code changed. A merge is in progress on the GitButler
tree; these are working-tree planning docs only. The orchestrator commits later.

## Problem (one line)

PR #4831 disabled user-facing stdio MCP for security but, via one shared
`MCP_UNSUPPORTED_MESSAGE` gate, ALSO killed the internal channel that delivers Agenta
gateway/callback tools to Claude. Restore the internal channel; keep user stdio MCP disabled.

## The layering (decision to confirm)

| Layer | #4831 | Target |
| --- | --- | --- |
| User MCP capability (stdio/NPX) | disabled | **keep disabled** |
| Internal gateway-tool MCP (runner → Claude) | disabled (collateral) | **restore** |
| User HTTP (remote) MCP (#4834) | enabled | unchanged |

## What #4831 broke (verified)

- `tools/mcp-bridge.ts` `buildToolMcpServers` now throws `MCP_UNSUPPORTED_MESSAGE` for any
  executable tool spec — this is the INTERNAL gateway-tool channel, wrongly disabled.
- `tools/mcp-server.ts` reduced to a refusing stub (the old stdio MCP server deleted).
- Combined with the later fail-loud work (`assertRequiredCapabilities`, commit `5170e577de`),
  a Claude run with gateway tools is now a **hard failure** (`ok:false`), not a silent drop:
  the capability gate asserts Claude can take tools (`mcpTools:true`), then delivery throws.
- Correctly kept: `toAcpMcpServers` stdio throw + `run-plan.ts` `hasStdioMcpServer` gate (the
  USER stdio path). Those stay.

## Smallest-correct-fix (recommendation)

Re-populate `buildToolMcpServers` to deliver the internal gateway-tool channel over an internal
loopback **HTTP** MCP endpoint (reusing #4834's `McpServerHttp` shape + Claude's native http-MCP
support), feeding the already-running runner relay for execution. Rename the user-facing
`MCP_UNSUPPORTED_MESSAGE` so the internal channel never reuses it. Leave the user stdio gate
untouched. **No wire/SDK/protocol/golden change** (the channel is synthesized from `customTools`,
not a new wire field). Fallback: restore the pre-#4831 stdio bridge but scope it to the internal
channel only (re-introduces a host process; not preferred). Full detail in [plan.md](plan.md).

## Decisions

- Treat MCP as THREE layers, not one: user-stdio (off), internal gateway-tool (on), user-http
  (on). Make this explicit in `buildSessionMcpServers` so it cannot be re-conflated.
- Prefer the internal HTTP MCP transport (no runner-host process) over restoring the stdio
  bridge — it satisfies #4831's intent and reuses #4834's path.
- No wire change: the internal channel is runner-synthesized from `customTools`.
- Credentials stay server-side; the channel advertises public metadata only and relays
  execution to the runner (unchanged from the pre-#4831 design).

## Open questions

1. **Transport: internal HTTP MCP (option 1) vs restore the scoped stdio bridge (option 2)?**
   Recommendation: option 1. Needs author confirmation — option 1 means implementing a minimal
   MCP HTTP *server* in the runner (the framing must be pinned to the installed ACP / Claude
   version; #4834 delivered the http *entry* but did not implement a server).
2. **Naming:** rename the user-facing constant to `USER_MCP_UNSUPPORTED_MESSAGE` (or similar)
   and reserve a distinct internal-channel concept? Confirm the rename is in scope.
3. **Loopback reachability under Daytona:** the internal HTTP endpoint is on the runner host;
   on Daytona the harness runs in the sandbox. Does Claude-on-Daytona reach a runner-loopback
   URL, or must the internal channel use the file relay (as today) for the Daytona case and
   HTTP only for local? (The file relay already works on Daytona; the delivery/advertisement is
   the only open part.) Pin during research-at-implementation.
4. **Codex review:** worth an `ask-codex` pass on the layering/naming before implementation.

## Next

- Author reviews this plan and answers the open questions (esp. transport choice + Daytona
  reachability).
- If accepted, schedule an `implement-feature` slice (runner-only: `mcp-bridge.ts` /
  `mcp.ts` / new internal MCP server + tests) and add it to
  [../../scratch/implementation-queue.md](../../scratch/implementation-queue.md). Keep docs in
  sync (`keep-docs-in-sync`): the interface inventory's MCP/tool-delivery entries and the
  sidecar-trust README's "what it removes" note both need the narrowed-disable correction.

## Provenance

- Project: gateway-tool-mcp. Session: 2026-06-25. Design-only.
- Source PRs: #4831 (the disable, `sidecar-trust-and-sandbox-enforcement/`), #4834
  (HTTP MCP, `http-mcp-transport/`), fail-loud commit `5170e577de`.
- Key files: `services/agent/src/tools/mcp-bridge.ts`, `tools/mcp-server.ts`,
  `engines/sandbox_agent/mcp.ts`, `engines/sandbox_agent/run-plan.ts`,
  `engines/sandbox_agent/capabilities.ts`, `tools/relay.ts`, `tools/dispatch.ts`,
  `tools/public-spec.ts`.
