# Status

## State

DESIGN ONLY. No code changed. Spun out of PR #4821 review comments 3470094826 + 3469961290 via
`/plan-feature`. Awaiting review of the plan before any implementation is scheduled.

## Source of truth

- The reviewer's two questions and the answers: [context.md](context.md).
- What exists today and where the deferral lives: [research.md](research.md).
- The proposed change: [plan.md](plan.md).

## Key findings (verified in the working tree)

- The SDK config (`MCPServerConfig`/`ResolvedMCPServer`), validator, resolver, and `to_wire()`
  **already model and serialize `transport: "http"` + `url` + named `secrets`**. The deferral
  is a single skip in the runner: `toAcpMcpServers()` in
  `services/agent/src/engines/sandbox_agent/mcp.ts` drops every non-stdio server.
- HTTP MCP is plausibly **simpler** than stdio: no child process, no `command`/`args`/`npx`
  bootstrap, no scoped-env plumbing. The only net-new concern is the auth **destination**
  (request header, not env) and respecting the sandbox network policy for the outbound URL.
- The harnesses already support HTTP MCP: the bundled `@zed-industries/claude-agent-acp`
  documents custom-header injection; Claude Code supports `type: "http"|"sse"` MCP with a
  `headers` map natively.

## Decisions

- Reuse the existing named-secret resolution (no new vault route). The config holds the secret
  **name**, never the token — same invariant as stdio.
- Recommended contract: add a `headers` map and route http secrets to headers (plan Slice 0,
  option B). To be confirmed in review.

## Open questions

1. Header vs env destination contract (plan Slice 0) — option A (overload `secrets`) vs option
   B (explicit `headers`). Recommendation: B.
2. Exact ACP HTTP-MCP variant shape (SSE vs streamable-HTTP, field names) — pin against the
   installed ACP version at implementation time.
3. Whether to gate the runner flip behind a flag for staged rollout.

## Next

- Review the plan. If accepted, schedule an `implement-feature` slice (SDK -> wire/golden ->
  runner -> docs) and add it to
  [../../scratch/implementation-queue.md](../../scratch/implementation-queue.md).
