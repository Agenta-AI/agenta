# Status

## State

IMPLEMENTED (runner-only). HTTP (remote) MCP transport is enabled in the sidecar; stdio MCP
stays disabled (#4831). Spun out of PR #4821 review comments 3470094826 + 3469961290 via
`/plan-feature`; built on PR #4834.

## What landed (vs. the plan)

The implementation took the **no-SDK-change** path, which is narrower than the plan's
recommended Slice 0 option B (an explicit `headers` field). Reason: the SDK resolver already
merges named secrets into the server's `env` for **both** transports, and `to_wire()` already
serializes `transport` + `url` + `env`. So the resolved http secret already rides the `/run`
wire under `env` — no SDK model change, no new `headers` wire field, no golden-fixture change.

- **Runner (`services/agent/src/engines/sandbox_agent/mcp.ts`).** `toAcpMcpServers` now
  delivers `transport: "http"` (+ `url`): it builds the ACP `McpServer` `type: "http"` variant
  (`{name, url, headers}`) and maps each `env` entry to an HTTP header. The author names the
  header via the secret-map key (`secrets: {"Authorization": "vault-name"}` → `Authorization`
  header). `transport: "stdio"` (+ `command`) still throws `MCP_UNSUPPORTED_MESSAGE`; a
  command-less stdio or url-less http server is skipped (logged), unchanged.
- **No SDK/protocol/wire change.** `models.py`, `resolver.py`, `wire.py`, `protocol.ts`, and
  the golden fixtures are untouched (this is why plan Slices 1-2 did not land).
- **Tests** (`tests/unit/mcp-servers.test.ts`): http delivered with the secret in a header;
  http with no secret → empty header list; stdio still throws; mixed input skips the
  non-deliverable entries. Full suite + typecheck green.
- **Network policy** (plan Slice 4): the outbound MCP URL is normal egress and obeys the
  existing Daytona network policy; no new allowlist surface added in this slice.

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
