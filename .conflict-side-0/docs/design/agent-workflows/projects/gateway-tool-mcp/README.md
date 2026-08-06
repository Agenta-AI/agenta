# Gateway-tool MCP delivery to Claude

Planning workspace for restoring the **internal gateway-tool MCP delivery channel** that
PR #4831 removed by accident when it disabled **user-facing stdio MCP** for security.

## The one-line problem

PR #4831 ("enforce sidecar trust + disable unenforceable sandbox boundaries") disabled the
sidecar's stdio MCP implementation to close a real security hole (user stdio/NPX MCP servers
launch arbitrary processes on the runner host, outside the sandbox boundary). In doing so it
ALSO killed the only channel that delivers **Agenta gateway/callback tools** to harnesses that
take tools over MCP only (Claude Code). Those two were conflated into one
`MCP_UNSUPPORTED_MESSAGE` gate. They are different layers and must be separable. This project
restores the internal channel while keeping the user-facing one disabled.

## The layering distinction (the heart of this project)

| Layer | What it is | Who declares it | Where it runs | Security posture | #4831 decision | This project |
| --- | --- | --- | --- | --- | --- | --- |
| **User MCP capability** | stdio/NPX MCP servers the user declares in their agent config (incl. code-execution servers) | The user, in `mcpServers` (`transport: "stdio"` + `command`) | A child process **on the runner host**, outside the sandbox boundary | Unsafe: arbitrary process, host network, no sandbox confinement | **DISABLED** (correct) | **Keep disabled** |
| **Internal gateway-tool MCP** | An internal delivery channel the runner stands up so Claude can receive Agenta gateway/callback tools (Claude only accepts tools over MCP) | Nobody — it is synthesized by the runner from the run's resolved `customTools` | An internal MCP endpoint the runner controls; tool execution relays back to the runner where it is resolved server-side | Safe: the channel carries only **public tool metadata**; credentials are resolved server-side a layer above (the sandbox/harness never sees a key) | **DISABLED** (collateral damage) | **Restore** |
| **HTTP (remote) MCP** | User-declared remote MCP servers reached over `https` with a secret in a request header | The user, in `mcpServers` (`transport: "http"` + `url`) | No runner-host process; the harness connects to the remote URL | Safe: no host process, secret in header, subject to the sandbox network policy | **ENABLED** by #4834 (a separate, third thing) | Unchanged; compose with it |

The trap #4831 fell into: it treated "MCP" as one capability. It is three. Disabling the
user-facing **stdio** one must not disable the internal gateway-tool one.

## Why the internal channel is secure even though the old one ran on the runner host

The security concern #4831 closed was the user **stdio** server: an author-supplied
`command`/`args` (e.g. `npx some-mcp`) that the runner launches as an arbitrary host process.
The internal gateway-tool bridge is categorically different:

- It carries **no user command**. It is synthesized by the runner from the run's already-
  resolved `customTools`.
- The channel only ever sees **public tool metadata** (`name`, `description`, `inputSchema`) —
  never the Composio key, the connection auth, or the callback bearer. Those stay in runner
  memory and are applied server-side via `/tools/call` (the relay), exactly as for the Pi path.
- Gateway-tool execution **already** runs runner-side and is governed by **Layer-3
  tool-permission** (`relay.ts` `resolvePermission`), not by the Layer-2 `sandbox_permission`
  network boundary. #4831's own README says gateway tools "need NO action — they are NOT part
  of `sandbox_permission`." Delivering them to Claude is the same category: a Layer-3 concern,
  not a sandbox-boundary one.

So the secure thing to restore is **delivery of gateway tools to Claude**, decoupled from the
user-stdio-MCP disable. The recommended transport for the restored channel is **HTTP MCP**
(the same safe transport #4834 enabled for users), so the restored channel reuses the proven,
no-host-process delivery and never re-introduces a stdio child. See [`plan.md`](./plan.md).

## Files

- [`context.md`](./context.md) — why this exists, goals/non-goals, the user's framing.
- [`research.md`](./research.md) — verified state: how Claude got gateway tools before #4831,
  exactly what #4831 disabled, the fail-loud interaction that makes the regression a hard
  failure today, and what #4834 (HTTP MCP) gives us to reuse.
- [`plan.md`](./plan.md) — the smallest correct change, the recommended transport, and the
  test plan.
- [`status.md`](./status.md) — state, decisions, open questions. **Source of truth.**

## Status

DESIGN ONLY — awaiting author review. No code changed. See [`status.md`](./status.md).
