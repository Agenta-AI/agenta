# Context

## Why this work exists

The runner sidecar (`services/agent/`) runs the agent loop for several harnesses. Pi receives
Agenta gateway/callback tools **natively** through the bundled Pi extension
(`extensions/agenta.ts` `registerTools`), so it never needed MCP. Claude Code accepts tools
**only over MCP**. So the runner stood up an internal MCP bridge to hand Claude the same
resolved gateway tools, with every call relayed back to the runner where the credentials live.

PR #4831 ("enforce sidecar trust + disable unenforceable sandbox boundaries") disabled the
sidecar's stdio MCP path to close a genuine hole: a **user-declared** stdio/NPX MCP server
launches an arbitrary process on the runner host, outside the sandbox boundary, so a
network-blocked sandbox does not confine it (the same runner-host execution bypass that had
code-tool execution removed). That disable was correct **for user MCP servers**.

But #4831 routed BOTH the user-facing path and the internal gateway-tool path through one
gate (`MCP_UNSUPPORTED_MESSAGE`). Its own README states the collateral damage plainly:

> non-Pi harnesses (e.g. Claude) take tools only over MCP, so they can no longer receive
> custom tools

That is the bug. Gateway tools should still reach Claude. The user's framing:

- **User-facing MCP servers** (stdio/NPX, incl. code-execution): correctly DISABLED. They run
  on the runner host, outside the sandbox boundary. Keep them off.
- **Internal gateway-tool delivery to Claude**: Claude only accepts tools over MCP, so the
  runner stands up an INTERNAL MCP to hand Claude the Agenta gateway/callback tools. This is
  not a user "MCP capability"; it is an internal delivery channel, and it is SECURE because the
  gateway tools are resolved server-side (a layer above) — the sandbox never sees a credential.
  Restore this.

The two were conflated; they must be INDEPENDENT layers.

## What makes this urgent now (not just a silent drop)

A later change (commit `5170e577de`, "fail loud on missing harness capabilities") added
`assertRequiredCapabilities`. A Claude run carrying tool specs now does NOT silently drop them
— it reaches `buildSessionMcpServers`, which calls `buildToolMcpServers`, which **throws
`MCP_UNSUPPORTED_MESSAGE`**, so the whole run fails with `{ ok: false, error: "MCP servers are
not supported by the sidecar." }`. So today: **Claude + any gateway tool = hard run failure.**
Pi + the same tools works (native delivery). That asymmetry is the user-visible regression.

## Goals

1. Restore delivery of Agenta gateway/callback tools to Claude (and any non-Pi, MCP-only
   harness), so a Claude run with gateway tools succeeds and the tools are callable.
2. Keep the two layers independent: disabling user stdio MCP must NOT disable the internal
   gateway-tool channel, and vice versa.
3. Preserve the server-side credential invariant: the sandbox/harness sees only public tool
   metadata; the Composio key / connection auth / callback bearer never leave runner memory.
4. Compose cleanly with #4834 (user HTTP MCP) and the fail-loud capability work — no
   double-gating, no regressions to either.

## Non-goals

- **Re-enabling user stdio/NPX MCP servers.** Explicitly out of scope. They stay disabled
  until their host-process security is solved (a separate future project).
- Changing the gateway/Composio resolution, the `/tools/call` contract, or Layer-3
  tool-permission semantics. Those are correct and untouched.
- Changing how Pi receives tools (native extension; unaffected).
- New vault routes or new secret handling. The internal channel carries no secrets at all.
- mTLS / payload encryption / scoped tokens — those are the deferred sidecar-trust hardening
  items, unrelated to this delivery channel.

## Relationship to neighboring projects

- **`sidecar-trust-and-sandbox-enforcement/`** (PR #4831) — the source of the disable. This
  project narrows that disable to user stdio MCP only and restores the internal channel. The
  two not-implemented gates it added (local `network`, any `filesystem`) and the loopback
  binding + `/run` token are unrelated and stay.
- **`http-mcp-transport/`** (PR #4834) — enabled user-declared `transport: "http"` MCP. It
  proves the runner can deliver MCP servers over HTTP with no runner-host process and a secret
  in a header. This project reuses that exact safe transport for the internal channel.
- **`capability-config/`** — built the Layer-2 (`sandbox_permission`) and Layer-3
  (tool-permission) split. This project lives entirely in Layer-3 / tool delivery; it does not
  touch Layer-2.
