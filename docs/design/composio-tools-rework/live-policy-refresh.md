# Proposal: live gateway policy refresh

Status: PROPOSAL, not decided. This page designs the "option 2" follow-up: after the
agent commits a new integration mid-turn, that integration's tools work in the SAME
turn, with no turn boundary and no user message. The decided base design is in
[data-model.md](data-model.md), [runtime-tools.md](runtime-tools.md), and
[permission-layers.md](permission-layers.md).

## What happens today, and the one fact that makes this cheap

The SDK compiles the agent's gateway policy once, at run start, and the runner enforces
that snapshot for the whole turn. A `commit_revision` that adds an integration succeeds,
but the model keeps the old snapshot until the next run.

The fact that makes a live refresh cheap: adding an integration does not change the
model's tool list. `search_tools` and `run_tool` are the same two tools for every
integration. Only the runner-private permission table (`gatewayPolicy`) changes. The
harness, the prompt tool list, and the wire schemas all stay as they are. So for an
agent that already holds at least one `gateway_connection`, "make the new integration
available" means "swap one table inside the runner".

## Scope

- IN: an agent with at least one `gateway_connection` commits a change to
  `parameters.agent.tools` mid-turn (add an integration, change a policy, remove one).
- OUT (phase 2): the FIRST connection on an agent that had none. There the two runtime
  tools themselves must appear mid-turn, which needs the MCP `tools/list_changed`
  notification on the loopback path and a spec-file refresh on the Pi path. Until phase
  2, that case keeps the auto-resume path (option 1) or the next user message.

## Design

### 1. Detection, at the seam the runner already owns

The runner relays every platform op, so it sees a successful `commit_revision` result
pass through. On success, it marks the turn's gateway policy STALE. No parsing of the
delta in V1: any successful commit marks stale, because a wasted refresh is one cheap
HTTP call and a missed one is this feature failing.

### 2. Refresh, compiled where the compiler already lives

The runner never compiles policy (permission parity stays two-sided: one Python
compiler, one TypeScript enforcer). It fetches a fresh table:

- New thin endpoint on the agent service: `POST /agent/gateway-policy` with the
  variant reference and the run credential. The handler reuses exactly the run-start
  path: read the variant's LATEST committed revision, call `/tools/resolve` for the
  catalog slices, run `compile_gateway_permissions`, return the same `gatewayPolicy`
  wire shape from contracts section 5. No new compilation logic anywhere.
- The runner calls it with the credential it already holds for callbacks, passes the
  result through `normalizeGatewayPolicy` (the same branded intake every consumer
  already requires), and swaps the table.

### 3. The swap, atomic per tool call

The relay seam today builds its gateway machinery once per turn around one policy
value. That reference becomes mutable with one rule: EACH TOOL CALL captures the table
once at its own start and uses that capture for its whole life (gate decision, context,
search filter, suggestion sanitizing). A call never mixes two tables; two calls may see
two tables. The stale-mark and the swap happen between calls.

Refresh timing: lazily, at the START of the next gateway call after the stale mark
(never in the middle of one), so the first `search_tools` after the commit waits one
policy fetch (~resolve latency, cached catalog) and then sees the new integration.

### 4. What the model is told

The prompt's "Connected integrations" line was written at turn start and goes stale
until the next rebuild. Two mitigations, both text:

- The `commit_revision` success result appends one sentence when the committed delta
  touched `tools`: "The integration is available now. Call `search_tools` to use it."
- The dynamic surfaces already tell the truth from the LIVE table: the scoped-search
  refusal names the configured set from the policy, which after the swap includes the
  new integration.

No prompt rewrite mid-turn. The next turn's rebuild refreshes the static line, as today.

### 5. Invariants and failure behavior

- Policy only moves FORWARD along the variant's committed history during a turn. The
  refresh always compiles the latest committed revision; it never reverts.
- A failed refresh keeps the CURRENT table and logs one line. Fail-static, not
  fail-open: the old table is a policy the author committed; an empty or guessed table
  is not. The next turn's normal rebuild self-heals.
- The operator kill-switch is unaffected: it is already read live inside the shared
  decision path, above any table.
- Approval identity is unaffected: keys hash the coarse tool name plus the full outer
  arguments and never reference the table.
- A `deny` tightened mid-turn takes effect at the next call, same latency as an `allow`
  loosened. Both directions swap together; there is no allow-only fast path.

### 6. Tests

- Runner unit: a swap is visible to the next `planGatewayRun` and invisible to a call
  already in flight; a failed refresh keeps the old table; the refreshed table passes
  the branded intake; the stale-mark sets on a successful commit result and not on a
  failed one.
- Composition (through `startRelayFromProductionWiring`): commit then search in one
  turn keeps the new integration's tools.
- Service unit: the endpoint returns the same table the run-start path produces for the
  same revision (golden comparison).
- Live QA: one prompt, "connect Google Drive and find file X": the agent commits, the
  same turn's search returns Drive tools, the run executes. The first-connection case
  asserts the documented behavior (resume path), not the swap.

## Cost

Runner: the stale-mark at the relay result, the lazy fetch, the mutable-reference
refactor of the once-per-turn seam, tests. Service: one thin endpoint reusing the
run-start compile path, one golden test. SDK: the one-sentence commit-result addition.
No wire change, no schema change, no frontend change. Rough size: the runner half is
the largest and is smaller than any single fix round from 2026-08-27.

## Why not the alternatives

- Runner-side compilation: duplicates the compiler in a second language; the permission
  parity suite exists precisely because that class of drift bites.
- Pushing the table from the service on commit: needs a server-to-runner push channel
  that does not exist; the lazy pull reuses the credentialed callback path.
- Rebuilding the whole turn (option 1) stays the fallback and the first-connection
  answer; it is visible to the user and loses warm in-turn state, which is exactly what
  this proposal removes for the common case.
