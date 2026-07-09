# Pi approval parking: implementation plan

Read [context.md](context.md) and [research.md](research.md) first; this plan assumes their
facts and cites code anchors from research.md without repeating the reasoning.

## The shape of the change, in one paragraph

Both Pi gates stop expressing an approval as a file-relay wait and raise it as
`ctx.ui.confirm(title, message)` from inside the sandbox, where `message` is a JSON envelope
carrying the real gate identity. The `pi-acp` bridge turns that dialog into a real ACP
`session/request_permission`, which lands at `attachPermissionResponder`, the same seam that
already holds, parks, and answers Claude gates. The runner parses the envelope into a proper
`GateDescriptor`, decides allow/deny instantly from the existing permission plan, and parks a
genuine ask with the slice-2 machinery (`parkedApproval`, pool, approval-resume dispatch). On
approve, `respondPermission` resolves the held dialog, the blocked hook returns, and the
original tool call runs inside the original still-open `prompt()`. The relay keeps doing what
it does well: delivering tool execution and results. Only the approval wait moves.

## The envelope (the one new contract)

The envelope is sandbox-internal (extension to runner, through the dialog message string). It
is not on the `/run` wire, so no golden-fixture change; it still deserves interface care
because two codebases parse it.

```json
{
  "v": 1,
  "kind": "agenta.gate",
  "gate": "pi-builtin" | "pi-custom-tool",
  "toolName": "<the resolved tool name the decision map keys on>",
  "toolCallId": "<Pi's tool call id>",
  "input": { }
}
```

Field roles: `v` and `kind` are protocol context (version + discriminator, so an unrelated
`confirm` from some future extension never misclassifies); `gate` is routing (which gate
raised it, for logging and for the executor field of the `GateDescriptor`); `toolName`,
`toolCallId`, `input` are the gate identity (data). The dialog `title` is fixed to
`agenta-approval` and acts as the cheap pre-filter; the envelope is the authority. Parsing is
strict: wrong `kind`, unknown `v`, or unparseable JSON means the request is NOT treated as a
Pi gate and falls through to today's spec-less handling, which pauses fail-closed. Never
guess.

The envelope maps to `GateDescriptor` as: `executor: "harness"` for `pi-builtin` (matches how
`relayPermissionCheck` keys builtins today via `piBuiltinIdentity`), `executor: "relay"` for
`pi-custom-tool`, `toolName` and `args` from the envelope. This keeps the stored-decision
keying (`decide` -> `stored.take(gate)`, name plus canonical args) identical across the warm
and cold paths, which is what makes a cold decision answer a re-issued call.

## Slices

### Slice 0: the live daemon confidence run (half a day, gates everything)

The spike drove `pi-acp` directly; the runner ships through the sandbox-agent daemon
(`acp-http-client` in between, source-verified passthrough). Re-run the spike's `allow` and
`hold` scenarios through a sandbox-agent daemon session before writing feature code. Reuse the
committed spike assets
(`../session-keepalive/followups/parkable-gates/spike-option-c/spike-extension.js`,
`acp-client.mjs` adapted to the daemon HTTP API). Pass criteria: the permission request
reaches a runner-side `onPermissionRequest` handler with the envelope intact, and the
three-minute hold still resumes the original call. Fail criteria route back to the
parkable-gates design's Option B fallback; do not improvise.

### Slice 1: envelope parsing and gate classification (runner side)

- New module `src/engines/sandbox_agent/pi-gate-envelope.ts`: `PI_GATE_DIALOG_TITLE`,
  `buildPiGateEnvelope` (shared with the extension via the existing bundling), and
  `parsePiGateEnvelope(request) -> {gate, toolName, toolCallId, input} | undefined` (strict,
  version-checked).
- `acp-interactions.ts`: in `handleRequest` (`:186`), before `buildGateDescriptor`, try
  `parsePiGateEnvelope`. On a hit, build the `GateDescriptor` from the envelope and stamp the
  emitted `toolCall` payload with the envelope identity (reuse the `resolvedName` stamping at
  `:77-81`, and synthesize the card's `rawInput` from `input` so the approval card shows real
  arguments, not envelope JSON). Everything downstream (responder, `decide`, latch,
  `pauseUserApproval`, interaction row) is unchanged code.
- Reply mapping: `decisionToReply` (`responder.ts:485-493`) falls back to `once`/`reject`,
  but the Pi dialog offers `yes`/`no`. Fix generically: choose by option `kind`
  (`allow_once`/`reject_once`) from the request's options when the literal ids are absent.
  One function, unit-tested against both harnesses' option shapes.
- Unit tests: envelope parse (valid, wrong kind, wrong version, hostile strings from the
  spike probe), classification (envelope hit vs spec-less fallthrough), reply mapping.

Deliverable: a Pi dialog gate flows through the responder with the right identity and gets an
instant allow or deny; an ask pauses exactly like today (no parking yet). Ship-safe alone.

### Slice 2: the extension switch (sandbox side)

- `agenta.ts` builtin hook (`:181-207`): when the new flag is on, replace
  `relayPermissionCheck` with `await ctx.ui.confirm(PI_GATE_DIALOG_TITLE,
  JSON.stringify(envelope))` (no `opts`, so no reaper; fail-closed `false` on any
  cancellation). `true` -> allow (`undefined`), `false` -> `blockReason`.
- `agenta.ts` custom-tool wrapper (`:273-276`): when the flag is on, gate BEFORE
  `runResolvedTool` with the same dialog; only an allow proceeds to the relay execution.
- Double-gate handling: the relay watcher still runs `permissions.decide` on the execution
  request (`relay.ts:240-264`). After a dialog allow, that second check must pass. Chosen
  mechanism: when the responder answers a Pi dialog gate with allow (instant or resumed), it
  records the decision into the turn's stored-decisions structure (the same object `decide`
  consults), so the relay check consumes it (`stored.take`). This keeps the relay as
  defense-in-depth with one source of truth, instead of disabling it. The alternative
  (skip relay enforcement when the dialog plane is on) removes the second check entirely;
  rejected because a bug in the extension flag plumbing would then leave zero gates.
- Flag: `AGENTA_RUNNER_PI_DIALOG_GATE` (default off), read runner-side in `run-plan.ts` and
  exported into the sandbox env (the existing pattern, research.md §7). One flag controls
  both sides coherently because the runner installs the extension per run (research.md §6).
- Tests: extension-level unit tests run through the existing extension test seams; a
  dispatch-level test that a dialog-allowed custom tool executes exactly once through the
  relay.

Deliverable: with the flag on, both Pi gates ride the dialog plane end to end; asks still
pause-and-destroy (parking arrives in slice 3). Behavior with the flag off is byte-identical.

### Slice 3: park and resume

- `sandbox_agent.ts` `onUserApprovalGate` (`:1321-1338`): record `parkedApproval` for the Pi
  dialog gate too, with `gateType: "pi-dialog-permission"` and the envelope identity. The
  pause exemption (`:1145-1152`), pool park, TTL, and eviction paths need no change; they key
  on `parkedApproval`, not on the harness.
- `server.ts` resume (`:648-676`): unchanged flow; the resume's `respondPermission` needs the
  slice-1 reply mapping (allow -> the `allow_once` option) and, for a custom-tool gate, the
  stored-decision record from slice 2 so the follow-on relay execution passes.
- Multi-gate: Pi raises one dialog at a time (the hook blocks the loop), so
  `approvalGateCount` stays 1 on this path; assert that in a test rather than assuming it.
- Tests: dispatch tests mirroring the slice-2 keep-alive suite (park on ask, resume-approve
  runs the original call, resume-reject blocks it, TTL expiry falls cold, approval-mismatch
  evicts). Fake-session seams already exist (`SandboxAgentDeps`, `createAgentServer(run)`).

Deliverable: the invariant holds for Pi warm approvals. This is the feature.

### Slice 4: QA and the live matrix

Run the warm/cold matrix below live on the dev box (playground + programmatic), flag on and
off, plus one Daytona run to confirm the degrade row. Record results in status.md. Keep the
existing agent-replay-test practice: pin one recorded warm approve and one cold approve as
regression tests.

## What is removed, what is kept, what is added

| Area | Removed (flag on) | Kept | Added |
|---|---|---|---|
| Extension (`agenta.ts`) | the `relayPermissionCheck` call in the builtin hook; the naked `runResolvedTool` for gated custom tools | tool registration; `runResolvedTool` relay EXECUTION (results still flow over the relay files); the old permission path behind the flag for rollback | the dialog gate (`ctx.ui.confirm` + envelope) at both gates |
| Relay (`relay.ts`, `dispatch.ts`) | nothing yet (`relayPermissionCheck` and `handlePermissionRelayRequest` become dead when the flag is on; delete after a bake period, recorded follow-up) | the watcher, execution dispatch, `permissions.decide` defense-in-depth | none |
| Responder seam (`acp-interactions.ts`) | nothing | all pause/park/reply mechanics | envelope detection + `GateDescriptor` from envelope + card payload synthesis |
| Reply mapping (`responder.ts`) | nothing | `once`/`reject` literals for Claude | kind-based option selection (`allow_once`/`reject_once`) |
| Park record (`sandbox_agent.ts`) | nothing | everything | `gateType: "pi-dialog-permission"` + envelope identity in `parkedApproval` |
| Stored decisions | nothing | keying (name + canonical args) | responder writes a consumed dialog-allow into the turn's stored decisions (the double-gate bridge) |
| Config | nothing | `AGENTA_RUNNER_SESSION_KEEPALIVE`, TTLs, pool cap | `AGENTA_RUNNER_PI_DIALOG_GATE` (default off; flip default after slice 4 greens) |
| Wire contract | nothing | everything (`interaction_request` shape unchanged; card payload uses existing fields) | nothing (assert with the existing wire-contract test) |

## The warm/cold behavior matrix

"Warm" means keep-alive on, session parked, answer inside the approval TTL. Every other cell
is cold. Flag names: KA = `AGENTA_RUNNER_SESSION_KEEPALIVE`, DG = `AGENTA_RUNNER_PI_DIALOG_GATE`.

| Scenario | Behavior |
|---|---|
| Warm approve (KA+DG on, within TTL) | The resume answers the held dialog; the hook returns allow; the original call runs with its original arguments inside the original `prompt()`; call N+1 carries the real result for the original id. Byte-exact. |
| Warm deny | The resume answers `no`; the hook returns `blockReason`; the tool call reports failed; the turn continues live on the same session (Pi handles the block in-loop). Nothing executes. |
| Approve after TTL (cold) | The park expired and the session was destroyed (the held dialog died with it, fail-closed). The decision lands on today's cold path: cold replay, the model re-issues the call, `decide` consumes the stored decision by name plus canonical args. After harness session resume lands, the same but with full structured history (rubric B); either way the decision map absorbs drift by re-firing the gate on mismatch. |
| Deny after TTL (cold) | Same path; the stored deny blocks the re-issued call. |
| ACP transport drop mid-pending | The spike's drop scenario: `pi-acp` and Pi die cleanly, nothing executes. The pool's parked-promise rejection evicts the slot; the next message runs cold. Degradation target is tier-2 session resume once that project lands (the pending call is already on Pi's disk). |
| TTL expiry racing an approval | The pool's existing race handling: expiry destroys and the late decision misses the pool (`approval-mismatch`/pool-miss path) and degrades to the cold decision map. The durable row was written at pause time, so the answer always lands. No new code; covered by an existing-pattern test. |
| KA on, DG off | Exactly today: relay-poll gates, pause destroys the session, cold decision-map resume. |
| KA off, DG on | The dialog gate still works (instant allow/deny from the responder; better card identity), but an ask pauses and destroys the session (no pool), and the dialog dies with it, fail-closed. Cold resume as today. Acceptable, but flip DG on only where KA is on to avoid a confusing half-state; state this in the rollout note. |
| Both off | Byte-identical to today. |
| Daytona (any flags) | The pool does not park Daytona sandboxes (keep-alive slice 3 deferred), so every Daytona ask is the "KA off" row: pause, destroy, cold decision-map resume. The dialog transport itself works on Daytona (the extension and env flow are identical, research.md §6), so when slice 3 lands, Daytona parking needs no Pi-specific work. |

## Rollout and compatibility

- **No image skew for the extension.** The runner installs `agenta.js` per run from its own
  bundle (research.md §6); runner and extension deploy atomically. The only mixed state is a
  session created before a deploy and resumed after it; the pool's config fingerprint and the
  restart-drains-pool behavior make that a cold resume, which both transports handle.
- **Flag order.** Ship slices 1-3 dark, then enable `AGENTA_RUNNER_PI_DIALOG_GATE` on the dev
  stack with keep-alive already on, run slice 4, then default it on. The old relay permission
  path stays in the code one release as the rollback lever, then gets deleted (follow-up).
- **pi-acp is pinned** (0.0.29). The dialog reaper behavior and the extension-UI translation
  are version-load-bearing; a Pi or pi-acp upgrade must re-run the spike's hold scenario
  (this is in the risks of the parkable-gates design; repeat it in the upgrade checklist).

## Recorded follow-ups (out of scope)

1. Upstream a structured-metadata field to `pi-acp` (maintainer Sergii Kozak, svkozak/pi-acp)
   or carry a pnpm patch, retiring the envelope encoding.
2. Delete `relayPermissionCheck` / `handlePermissionRelayRequest` after the bake period.
3. Daytona parking (keep-alive slice 3) picks up Pi parking for free; verify then.

## Test inventory (summary)

- Unit: envelope build/parse round-trip (incl. the spike's hostile probe string), request
  classification (envelope vs spec-less), reply-option mapping (Claude ids, Pi kinds), stored
  decision write-through on dialog-allow.
- Dispatch (fake session): Pi ask parks; resume-approve runs original call once; resume-deny
  blocks; TTL expiry -> cold; approval-mismatch evicts; `approvalGateCount` stays 1;
  double-gate (dialog allow then relay execution) executes exactly once.
- Wire contract: assert no `/run` or `interaction_request` shape change (existing tests).
- Live (slice 4): the matrix above on the dev box, plus the pinned replay regressions.
