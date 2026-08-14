# WP15 — tasks

Read [`specs-wp15.md`](specs-wp15.md) first. Branch from WP13's wire commit, not from M4 —
the two packages share `protocol.ts` and editing it in parallel is how a stack scrambles.

## Phase 0 — the reachable set (OD17)

- [ ] For each server this package targets, read whether it answers a plain stateless `POST`
      with no session minted, and whether it needs the SSE leg for ordinary calls. Source it
      from the server's own documentation or a probe, never from assumption.
- [ ] Record the per-server reading in the package's findings, including the servers that
      fail and why.
- [ ] If most targeted servers are still on a session revision, **stop and report** — that is
      a D8 decision, not a wiring problem.

## The route

- [ ] Build `connection.url` as `{gateway_base}/gateways/mcps/{namespace}/...` from D30's
      grammar: `builtin/{provider}/{integration}/{connection}`, `builtin/agenta/{slug}`, or
      `custom/{slug}`. The MCP protocol POSTs to that URL directly — nothing is appended.
- [ ] Gateway base URL from the shared `env` object, never `os.getenv` at the call site.

## The credentials

- [ ] `connection.credentials` carries our credentials in the gateway header, using the
      existing `{ kind: "header", name }` binding. No new binding is needed on this side.
- [ ] The upstream server's own token does not appear. It is the gateway's now.
- [ ] Unit: a gateway-routed server config has our header and no upstream token.

## The policy

- [ ] `policy.tools` passes through unchanged. The gateway's filter and the runner's policy
      are two enforcement points and both stay — do not remove either because the other
      covers it.
- [ ] Unit: `policy.tools` survives resolution unchanged.

## Tests

- [ ] Unit: tool names, schemas and errors are untouched end to end (D16).
- [ ] Acceptance: a run's tool calls reach a server through the gateway with no server token
      in the sandbox, and appear as audit events (WP4).
- [ ] Commit: "gateways(runner): point MCP servers at the gateway".

## Definition of done

- No upstream server token reaches a sandbox, proven from inside it.
- A gateway-routed server behaves identically to a direct one from the agent's view.
