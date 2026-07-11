# Plan

This implements the recommendation in [options.md](options.md), revised per
[design-review.md](design-review.md): Option C (a compiled builtin disposition injected
into the sandbox) plus a narrow Option B (a file gate for residual builtin calls only),
custom-tool authorization at the existing execution relay, an acknowledged two-lifetime
timeout, and integrity protection on the decision file.

One release unit. The phases below order the work, but they land together: under the
default `allow_reads` policy, disposition injection alone would fix reads while bash,
edit, and write still hang, and custom-tool confirms would stay broken. Do not ship a
partial cut.

## Phase 0: reproduce and pin

- Reproduce F-018 on Daytona in the playground. Record the session ids and the
  `[run-limits]` line that kills the turn. Confirm no `[HITL] pi-gate` line appears for
  the Daytona session while an identical local run logs one.
- Capture a `/run` pair for a builtin call on Daytona under `../qa/runs/`, per the
  `agent-replay-test` skill. Replay pins the runner-side logic only; it cannot prove the
  Daytona proxy delivers reverse requests, so live verification (Phase 5) stays the proof
  for the transport.
- Keep Daytona spend minimal; reuse an existing failing capture if one is recorded.

## Phase 1: the compiled builtin disposition (Option C)

### Runner side

- Add a disposition compiler to `permission-plan.ts`, next to `effectivePermission` and
  the rule matcher, so rule semantics stay in one place. For each granted builtin it
  resolves the policy with no call arguments and emits one of:
  - `allow`: the policy statically allows this builtin.
  - `deny`: the policy statically denies it.
  - `runner`: the runner must decide at call time. Both `ask` and any
    argument-dependent rule (a prefix rule like `Bash(git:*)`) compile to `runner`.
- `run-plan.ts` calls the compiler and passes the result to the env injection. It does
  not re-implement rule matching.
- `pi-assets.ts` `buildPiExtensionEnv` injects the map when builtin gating is active.
  Shape (versioned, strict):

  ```json
  {"v": 1, "builtins": {"read": "allow", "bash": "runner", "write": "deny"}}
  ```

- Also inject the gate transport capability explicitly:
  `AGENTA_AGENT_GATE_TRANSPORT=acp|file` (`acp` for local, `file` for Daytona). The
  extension must never infer the transport from a directory path or provider name.

### Extension side

- `registerBuiltinGating` reads the map and validates it strictly. A missing or
  malformed map, an unknown disposition value, an unknown builtin name, or a
  grant/disposition mismatch routes the call to the runner gate or fails closed. It
  never silently allows.
- On a `tool_call` for a builtin: `allow` runs with no gate; `deny` blocks with the
  policy reason and no gate; `runner` raises the gate on the configured transport.
- Local keeps `acp` transport and so keeps today's confirm behavior for `runner`
  builtins; `allow` and `deny` stop round-tripping on local too, which is a latency win
  on one shared code path.

## Phase 2: the file gate for residual builtins (Option B, narrowed)

Only a `runner`-disposition builtin on the `file` transport uses this. Custom tools do
not (Phase 3). Every call on this channel pays remote filesystem polling latency, which
is another reason the disposition map handles the common case.

### Protocol

Files in the relay dir, alongside the existing execution relay but with distinct
suffixes so the two protocols never collide:

- Gate request (extension writes): a collision-resistant request id in the name; body
  reuses the gate identity (version, kind discriminator, gate kind, tool name, the
  model's tool-call id, arguments). Extract a shared identity validator from
  `pi-gate-envelope.ts` and define separate versioned ACP and file wrappers around it;
  do not reuse the ACP parser (it is coupled to the ACP request shape and its validator
  is private). The envelope stays identity-only; the runner recovers policy from its own
  resolved specs.
- Acknowledgment (runner writes): a `received` marker as soon as the responder has the
  gate. This is what makes the two-lifetime timeout implementable (Phase 4).
- Decision (runner writes): `allow` or `deny` plus a status field, authenticated (below).

### Runner side

- Start the relay loop whenever builtin gating is active on the file transport, not only
  when custom tools exist (`plan.useToolRelay`). Pass the relay dir for builtin gating in
  `buildPiExtensionEnv`.
- The relay loop recognizes a gate-request file, acknowledges it, and runs the identity
  through the same responder policy `handlePiGate` uses. Allow or deny writes the
  decision immediately. A pending (human) decision follows Phase 3.

### Decision-file integrity

The relay dir is sandbox-writable, and for a builtin the decision file IS the
authorization (unlike a custom-tool result, whose execution the runner-side relay guard
already protects). An unsigned `allow` file is not demonstrably runner-authored. So:

- The runner mints a per-run gate secret and delivers it to the extension via a
  read-once 0600 file, the same pattern as the OTLP bearer (`pi-assets.ts`,
  `writeOtlpAuthFile`). Decision files carry an HMAC over the request id and verdict.
  The extension verifies before honoring an allow; a bad or missing tag fails closed.
- Independent of the tag, document the narrowed threat model: builtin gating protects
  against a prompt-injected model, not against an arbitrary hostile process that
  controls the sandbox (which can already run anything a builtin could). And once a run
  allows unrestricted bash, builtin permissions are not a meaningful confinement
  boundary for later in-sandbox effects.

## Phase 3: approval state across the pause, and custom tools at the relay seam

### Custom tools: authorize at the execution relay

Drop the separate gate round-trip for custom tools on the file transport. The execution
request the extension already writes becomes the authorization seam. The relay guard
already re-runs `decide()` there:

- Allow: execute.
- Deny: return a denied tool result.
- Pending: emit the existing `interaction_request`, pause, and do not execute. No
  execution grant ledger is needed on this path, because decision and execution are the
  same request, handled atomically. (The ACP confirm path keeps `onPiGateAllowed` and
  the grant ledger as today.)

### The two resume paths, defined explicitly

The draft plan assumed the existing pause and resume model absorbs a file gate. It does
not: the relay loop stops when the turn pauses, and parked approvals are ACP-only (a
live park holds an ACP permission id answered via `respondPermission`; a unit test
asserts file-relay gates are non-parkable). Define both paths:

- Cold path (default; keep-alive off, and F-020 means Daytona recreates sandboxes
  anyway): on pause, the turn ends and the sandbox is destroyed with the pending gate
  file inside it. Nothing is written back later. On the next turn, the stored decision
  from the human's answer is in place, the model reissues the call (session continuity
  restores the transcript), and the reissued gate resolves instantly from the stored
  decision. This mirrors how the ACP path already resumes cold.
- Live path (keep-alive on): extend the parked-gate union with a file-transport variant
  that records the request id and relay dir instead of an ACP permission id. Resume
  writes the authenticated decision file (and restarts the relay loop for the session)
  instead of calling `respondPermission`. Server-side validation and resume dispatch
  learn the new variant. Until this variant exists, a file gate must take the cold path
  even under keep-alive; shipping file gates that silently break parking would be a
  regression.
- Cross-cutting rules for both: request ids are idempotent (a reissued call gets a new
  id), duplicate decisions are ignored after the first, a cancelled turn tombstones its
  pending gate so a late decision cannot resurrect it, and a late decision after a
  delivery timeout must not create a stale approval card.

## Phase 4: the two-lifetime timeout

One timeout around the whole gate cannot distinguish an undeliverable gate (the F-018
failure, must fail closed fast) from a human deliberating (must never be reaped;
`run-limits.ts` deliberately freezes all deadlines on pause). Split it:

- Delivery deadline: from writing the gate request until the runner's acknowledgment
  file appears. Short (seconds, env-overridable), fails closed with a clear result text
  such as "The approval request could not be delivered and was denied." The model loop
  continues; the turn never stalls to the 300s guard.
- Human approval lifetime: starts at acknowledgment. Owned by the existing pause
  teardown and stored-decision model, not by an extension timer.

On the ACP confirm path there is no acknowledgment signal, so no equivalent split exists
there today. Do not claim an all-path timeout: local ACP gates keep their current
semantics (they work), and the honest statement is that the file transport is the one
with delivery-failure detection. If Option A ever lands, the ACP path can gain an
acknowledgment then.

## Phase 5: tests, live verification, docs

- Unit tests: the disposition compiler (every default mode, read-only hint, name rule,
  prefix rule mapping to `allow`/`deny`/`runner`); strict map validation (missing,
  malformed, unknown, mismatch); the file-gate protocol (ack, decision, HMAC verify,
  forged and unsigned decisions fail closed, duplicate decisions, tombstones, late
  results, cancellation); the relay-seam custom-tool authorization (allow, deny,
  pending); and the parked-gate file variant.
- Replay regression from the Phase 0 capture, as a runner-side pin.
- Live Daytona verification per `agent-workflows-qa`, minimum runs: builtin allow (read
  and bash), builtin deny, builtin ask approved, builtin ask rejected, a prefix rule,
  and a custom tool (allow and ask). Confirm the build-kit default agent's opening read
  works.
- Update F-018 in `../qa/findings.md` to resolved with the PR. Sync every doc that
  describes the builtin gate transport, per `keep-docs-in-sync`. Note the keep-alive
  interaction in the session-keepalive project docs if the parked-gate union changes.

## Interface shapes, reviewed by semantic role

Two shapes cross the runner-to-sandbox boundary. Fields are classified by what they are,
per the `design-interfaces` skill.

### `AGENTA_AGENT_BUILTIN_DECISIONS` (runner to sandbox, per session)

`{"v":1,"builtins":{"read":"allow","bash":"runner",...}}`

- `v` is protocol context (strict version check; mismatch routes to the runner gate).
- The builtin name key is data (identity), reusing the canonical names in
  `permission-plan.ts`.
- The disposition value is compiled policy. The runner owns the compilation; the
  extension only enforces. `runner` is deliberately not a policy verdict but a routing
  value: "this decision is not compilable, raise the gate."

Separate from `AGENTA_AGENT_BUILTIN_GRANTS` because grants are tool exposure
(membership) and dispositions are enforcement (policy per member): different roles,
different change cadence, and a run legitimately grants a builtin whose disposition is
`runner`.

`AGENTA_AGENT_GATE_TRANSPORT` is routing/protocol context (`acp` or `file`), injected
explicitly rather than inferred, so the transport decision has exactly one owner (the
runner) and one source of truth.

### The file-gate protocol (sandbox to runner and back)

- Request: protocol context (`v`, kind discriminator), routing (gate kind), identity
  data (tool name, tool-call id, args), and a collision-resistant request id (protocol
  context, correlation). No policy, no credential.
- Acknowledgment: protocol context only (delivery state for the timeout split).
- Decision: the verdict (policy, runner-owned), a status field (protocol context), and
  an HMAC tag (integrity, keyed by a per-run secret delivered via a read-once file; the
  secret itself never rides env or the relay dir).

The identity part shares one validator with the ACP envelope (extracted from
`pi-gate-envelope.ts`); the ACP and file wrappers version independently.
