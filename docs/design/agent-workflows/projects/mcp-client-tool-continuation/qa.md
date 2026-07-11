# Verification plan

Scope note (2026-07-11): the warm hold-open path is deferred behind the unlock gates in
[plan.md](plan.md). The WP0 and WP1 layers below apply now. Every layer tied to WP2 through
WP5 (registry, park, resume, hold, canary) applies only if the gates pass, and should then
be re-read against the revised design note in [interface.md](interface.md) (pool-owned
placement, slimmed delivery port, no standalone registry).

## Test layers

This project needs real transport tests in addition to engine unit tests. A fake response object
cannot prove socket lifetime, disconnect behavior, or JSON-RPC framing.

| Layer | Purpose | Required before |
| --- | --- | --- |
| Pure unit | Registry transitions, exact matching, pool state, limits | WP2 merge |
| MCP HTTP integration | Authentication, framing, hold, write, close, batch behavior | WP1 and WP3 merge |
| Runner integration | Park, resume, race, expiry, shutdown, cold fallback | WP3 and WP4 merge |
| Live local Claude | Client timeout and original-prompt continuation | WP0 and rollout |
| Resource test | File descriptors, pending caps, cleanup | Enablement |
| Security test | Unauthorized process, token leakage, cross-scope result | Enablement |

## Unit matrix

### Registry

- Register one operation.
- Reject a duplicate operation id.
- Reject a second pending operation for the same environment.
- Enforce the global cap.
- Allow exactly one claimant from two simultaneous claims.
- Reject wrong project, session, tool-call id, environment, and runner owner.
- Ignore duplicate and late completion after a terminal state.
- Expire and cancel idempotently.
- Cancel every operation owned by a destroyed environment.

### Result extraction

- Match exactly one current-turn result by ACP tool-call id.
- Reject no result, a different id, and two results with the same id.
- Do not use a prior turn's result.
- Preserve the same result for cold name-and-arguments fallback when live delivery fails.
- Keep approval envelopes separate from client-tool outputs.

### Session pool

- Park and check out `awaiting_client_tool` only through its dedicated method.
- Refuse idle and approval checkout for that state.
- Expire with a client-tool-specific reason.
- Do not evict another session after a checkout race.
- Destroy the environment exactly once on supersede, expiry, close, and shutdown.

## MCP HTTP integration matrix

Start `startInternalToolMcpServer` on a real ephemeral port and use a real HTTP client.

- Missing and wrong bearer tokens return unauthorized before tool listing or dispatch.
- The correct bearer can initialize, list tools, and call a normal tool.
- A client-tool call remains open without headers or a result until delivery.
- Delivery writes one JSON-RPC response with the original MCP request id and browser output.
- A second delivery does not write another response.
- Client disconnect invokes cancellation and removes the operation.
- Environment cancellation closes every active response.
- Server close drains held responses within the shutdown bound.
- A client-tool batch is rejected before any batch item runs.
- Oversized request and output bodies fail with bounded errors and release resources.

The likely focused command is:

```bash
cd services/runner
pnpm exec vitest run tests/unit/tool-mcp-http.test.ts tests/unit/client-tool-continuation.test.ts
```

The implementation PR must use the actual final test file names in its PR description.

## Runner integration matrix

| Scenario | Expected exact behavior | Required fallback |
| --- | --- | --- |
| Valid result on owning replica | Same MCP request and prompt continue once | None |
| Keepalive disabled | No live registration | Existing cold replay |
| Feature flag disabled | Current socket destroy | Existing cold replay |
| Local pool full | No held resource beyond cap | Existing cold replay |
| Wrong replica receives result | No access to owner handle | Existing cold replay |
| TTL expires before result | Handle closes and environment is destroyed | `session/load` or cold replay |
| Runner restarts | In-memory handle is gone | PR #5197 continuity, then cold store |
| MCP client disconnects | Cancel and evict | Existing cold replay |
| Mount credentials expire | Evict before delivery | Existing cold replay |
| Original prompt rejects | Cancel and evict | Cold only if nothing streamed |
| Duplicate result requests | One live claimant | Loser cannot redeliver |
| Second client tool arrives | Refuse second park | Cold path |
| Client-tool batch arrives | Reject before any item executes | Model can retry singly |

## Live local Claude protocol

1. Pin and record the runner image, Claude CLI, ACP adapter, and MCP SDK versions.
2. Start a local Claude run with session keepalive and one browser-fulfilled client tool.
3. Trigger the client tool and wait longer than 60 seconds before fulfilling it.
4. Confirm the same MCP request id and ACP tool-call id receive the result.
5. Confirm the original prompt continues and no new model-issued client-tool call appears.
6. Repeat beyond 300 seconds if the first hold succeeds.
7. Repeat with forced expiry, runner restart, and client disconnect. Confirm each uses cold
   fallback and does not lose the browser output.
8. Repeat with the flag off. Confirm behavior matches the current baseline.

Use the agent-workflows QA procedure for the live run and save a redacted transcript as regression
evidence. A stable successful run should become an agent replay regression test when the runner
response can be recorded without a live model.

## Security checks

- A sibling process in the same namespace cannot initialize, list, or call the internal MCP server
  without the per-environment bearer.
- A token for environment A cannot call environment B's server.
- A result for project or session A cannot claim an operation from project or session B.
- Logs, traces, metrics, thrown errors, and snapshots do not contain the bearer, raw arguments, or
  browser output.
- The result-size cap applies before serialization can cause unbounded memory growth.
- Unknown, late, and duplicate results fail closed and remain eligible for cold handling.

## Resource checks

- Park up to the configured session pool maximum.
- Record process file descriptors, registry size, held response count, RSS, and PSS.
- Submit one over-cap request and confirm it does not add a held response.
- Expire all operations and confirm descriptors and registry gauges return to baseline.
- Repeat with shutdown and client disconnect.
- Compare the socket delta separately from the live Claude process cost. Do not attribute the
  existing harness memory footprint to the continuation registry.

## Acceptance bar

- Exact continuation never crosses project, session, environment, or tool-call identity.
- One live operation completes at most once.
- Every failure path reclaims its socket, registry entry, and session.
- Browser output remains available to the cold fallback until live delivery succeeds.
- The flag-off path matches current behavior.
- Daytona remains explicitly unsupported for exact continuation and fails or falls back as it does
  before this project.

