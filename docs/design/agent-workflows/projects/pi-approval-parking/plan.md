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
`toolCallId`, `input` are the gate identity (data). The envelope carries identity only, never
policy: the permission metadata (`specPermission`, `readOnlyHint`) is recovered runner-side
from the run's own resolved specs (slice 1), because the sandbox is not trusted to state its
own permissions.

Parsing is strict, and a parse failure FAILS CLOSED, not through. The dialog `title` is fixed
to `agenta-approval` as the cheap pre-filter; a request whose title matches but whose envelope
does not parse (wrong `kind`, unknown `v`, malformed JSON) is answered with an immediate
reject. It must NOT fall through to the spec-less handling: under a permission plan whose
default is allow, a spec-less fallthrough resolves to allow, `ctx.ui.confirm` resolves true,
and an unapproved tool runs. A request whose title does not match is not a Pi gate and takes
today's path unchanged.

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
three-minute hold still resumes the original call. This run also doubles as the live check on
the reply mechanism: the daemon's `respondPermission(id, reply)` takes `reply` in
`{once, always, reject}` and maps it to the dialog's option BY KIND internally
(`permissionReplyToResponse`, `sandbox-agent/dist/chunk-TVCDKGSM.js:2811`; `PermissionReply`,
`index.d.ts:2976`), so a plain `respondPermission(id, "once")` must resolve the held dialog
to allow. Fail criteria route back to the parkable-gates design's Option B fallback; do not
improvise.

### Slice 1: envelope parsing and gate classification (runner side)

- New module `src/engines/sandbox_agent/pi-gate-envelope.ts`: `PI_GATE_DIALOG_TITLE`,
  `buildPiGateEnvelope` (shared with the extension via the existing bundling), and
  `parsePiGateEnvelope(request) -> {gate, toolName, toolCallId, input} | undefined` (strict,
  version-checked).
- **Normalize the tool-call id FIRST.** At the top of `handleRequest`
  (`acp-interactions.ts:186`), on an envelope hit, replace `req.toolCall.toolCallId` (the
  bridge's synthetic `pi-ui-<uuid>`) with the envelope's REAL id, before the `[HITL]` logging,
  `buildGateDescriptor`, `pauseUserApproval`, and `onPausedToolCall` all read it. Stamping
  only the emitted payload is insufficient, and the two failure modes are severe:
  `approvalDecisionForToolCall` (`session-pool.ts:231`, called at `server.ts:624`) matches the
  incoming decision against the parked id, so a synthetic id means the warm resume NEVER
  fires (silently always cold); and `pause.markPausedToolCall` would suppress frames for the
  wrong id, letting the real tool call's open part be settled as "not executed" while the
  Vercel egress keys approval chunks strictly on the payload's toolCallId (`stream.py:620`),
  clobbering the approval card in the frontend.
- `acp-interactions.ts`: on the envelope hit, build the `GateDescriptor` from the envelope
  identity and stamp the emitted `toolCall` payload (reuse the `resolvedName` stamping at
  `:77-81`, and synthesize the card's `rawInput` from `input` so the approval card shows real
  arguments, not envelope JSON). Everything downstream (responder, `decide`, latch,
  `pauseUserApproval`, interaction row) is unchanged code.
- **Recover permission metadata runner-side, never from the envelope.** The envelope names
  the tool; the runner looks the tool up in the run's own resolved specs by `toolName` (and
  through `piBuiltinIdentity` for `pi-builtin`) to fill `specPermission` and `readOnlyHint`
  on the `GateDescriptor`, restoring relay parity (the relay gate sets `spec.permission`
  today at `relay.ts:240`, and read-only builtin identity at `relay.ts:411-424`;
  `effectivePermission` consumes both at `permission-plan.ts:129-135, 248-256`). Without
  this, author-allow tools newly pause, author-deny tools route through pause instead of an
  instant deny, and read-only builtins get asked instead of auto-allowed.
- **Fail closed on a malformed envelope.** Title matches, envelope does not parse: reply
  reject immediately (see the envelope section above for why fallthrough is an unapproved
  execution under a default-allow plan).
- No reply-mapping work. The runner never sees the dialog's raw `yes`/`no` option ids; the
  sandbox-agent daemon's `respondPermission` maps `{once, always, reject}` to the option by
  KIND internally (slice 0 note above). `decisionToReply` (`responder.ts:485`) and the resume
  reply at `server.ts:648` are already correct for Pi. Do not widen the
  `ParkedApproval`/resume reply types.
- Unit tests: envelope parse (valid, wrong kind, wrong version, hostile strings from the
  spike probe), id normalization (gate descriptor, pause bookkeeping, and emitted payload all
  see the real id), spec lookup parity (author-allow stays instant-allow, author-deny stays
  instant-deny, read-only builtin auto-allows), malformed-envelope reject, non-matching title
  untouched.

Deliverable: dark. Nothing exercises this path until slice 2 turns the extension on, so the
slice ships as unit-tested code with zero behavior change; it is safe for Claude because a
non-matching title takes today's path untouched.

### Slice 2: the extension switch (sandbox side)

- `agenta.ts` builtin hook (`:181-207`): when the new flag is on, replace
  `relayPermissionCheck` with `await ctx.ui.confirm(PI_GATE_DIALOG_TITLE,
  JSON.stringify(envelope))` (no `opts`, so no reaper; fail-closed `false` on any
  cancellation). `true` -> allow (`undefined`), `false` -> `blockReason`.
- `agenta.ts` custom-tool wrapper (`:273-276`): when the flag is on, gate BEFORE
  `runResolvedTool` with the same dialog; only an allow proceeds to the relay execution.
  **Scope: non-client executable tools only.** `registerTools` registers every advertised
  spec including `client` tools (`public-spec.ts:43`), and client tools have their own
  browser-fulfilled pause semantics through the relay (`dispatch.ts:239`, `relay.ts:214`);
  permission-gating a client tool via the dialog would be wrong. The dialog gate applies to
  `callback` (and `code`) specs; `client` specs keep today's path untouched.
- Double-gate handling: the relay watcher still runs `permissions.decide` on the execution
  request (`relay.ts:240-264`). After a dialog allow, that second check must pass. The
  premise holds: the responder and the relay share the SAME `ConversationDecisions` object,
  built once per turn (`sandbox_agent.ts:1218`, consumed at `:1225` and `:1268`). But
  `ConversationDecisions` exposes only `take`/`peek` over private `decisionQueues`
  (`responder.ts:209-237`); there is no public write. The mechanism therefore is:
  - Add a FIFO append API to `ConversationDecisions` (a decision pushed onto the queue for a
    `(toolName, canonical args)` key, consumed by the next matching `take`).
  - On the COLD dialog path (a stored decision answers the dialog instantly), the dialog's
    `decide` call consumed one queued decision; append exactly one back for the relay
    execution check. Consume-1-append-1, so no stale decision survives to a LATER identical
    gate in the same turn.
  - The key-parity invariant, stated as a tested invariant, not an assumption:
    `envelope.toolName === spec.name` and `envelope.input` is the exact `execute` params
    object, so the approved-call key matches what the relay reads (`dispatch.ts:84` writes
    `args: params ?? {}`; `relay.ts:245` reads `req.args`).
  - The WARM-RESUME path bypasses the responder entirely (the resume calls
    `respondPermission` directly, `sandbox_agent.ts:1389`), so nothing on that path appends
    to the queue by construction. Slice task: verify whether `extractApprovalDecisions`
    already seeds the turn's stored map from the resume request's transcript (the FE folds
    the decision into the resume request). If it does, the relay check consumes that seeded
    decision and nothing more is needed; if it does not, add an explicit append on the
    resume branch just before `:1389`. Either way, cover it with the
    dialog-allow-then-relay-execute dispatch test on the RESUME path, not only the instant
    path.
  This keeps the relay as defense-in-depth with one source of truth. The alternative (skip
  relay enforcement when the dialog plane is on) removes the second check entirely; rejected
  because a bug in the extension flag plumbing would then leave zero gates.
- Flag: `AGENTA_RUNNER_PI_DIALOG_GATE` (runner side, default off), exported into the sandbox
  as `AGENTA_AGENT_PI_DIALOG_GATE` by `buildPiExtensionEnv` (`pi-assets.ts:67-78`, the same
  place `AGENTA_AGENT_BUILTIN_GATING` is set), which is where the extension env is actually
  built. One flag controls both sides coherently because the runner installs the extension
  per run (research.md §6).
- Relay scope note: once the flag is on, a builtin-only run (no custom tools) no longer needs
  the relay at all; `useToolRelay` (`run-plan.ts:447`) can be tightened to skip it. Document
  now, tighten in this slice if trivial, otherwise record as part of the deletion follow-up.
- Tests: extension-level unit tests run through the existing extension test seams (dialog
  raised for callback specs, NOT raised for client specs, fail-closed false on cancel); a
  dispatch-level test that a dialog-allowed custom tool executes exactly once through the
  relay (instant path and resume path); consume-1-append-1 accounting.

Deliverable: with the flag on, both Pi gates ride the dialog plane end to end; asks still
pause-and-destroy (parking arrives in slice 3). Behavior with the flag off is byte-identical.

### Slice 3: park and resume

- `sandbox_agent.ts`: two changes that only work together. (a) Widen the
  `ParkedApproval.gateType` union, today the single literal `"claude-acp-permission"`
  (`sandbox_agent.ts:368`), to include `"pi-dialog-permission"`, and record the park with the
  envelope identity in `onUserApprovalGate` (`:1321-1338`). (b) Update the `server.ts:628`
  guard, which today hard-rejects any parked gate that is not the Claude gate type, to accept
  `"pi-dialog-permission"` too. (a) without (b) means Pi always falls cold at the dispatch;
  (b) without (a) is a compile error. The pause exemption (`:1145-1152`), pool park, TTL, and
  eviction paths need no change; they key on `parkedApproval`, not on the harness.
- `server.ts` resume (`:648-676`): unchanged flow. The reply is already correct
  (`"once"`/`"reject"`; the daemon maps by kind, slice 0 note). For a custom-tool gate, the
  slice-2 warm-resume decision seeding applies so the follow-on relay execution passes.
- Multi-gate: no assertion needed, the degrade is already safe and harness-agnostic.
  `approvalToPark` refuses to park when `approvalGateCount > 1` (`server.ts:407`), so a
  hypothetical parallel second dialog degrades the whole turn to the cold path, and the
  unemitted second dialog dies with the destroyed session, fail-closed. Document this as the
  designed behavior; Pi's sequential loop makes it a non-case in practice.
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
| Extension (`agenta.ts`) | the `relayPermissionCheck` call in the builtin hook; the naked `runResolvedTool` for gated NON-CLIENT custom tools | tool registration; `runResolvedTool` relay EXECUTION (results still flow over the relay files); client tools' browser-fulfilled path untouched; the old permission path behind the flag for rollback | the dialog gate (`ctx.ui.confirm` + envelope) at both gates, non-client specs only |
| Relay (`relay.ts`, `dispatch.ts`, `run-plan.ts`) | nothing yet (`relayPermissionCheck` and `handlePermissionRelayRequest` become dead when the flag is on; delete after a bake period, recorded follow-up; a builtin-only run can stop starting the relay, `useToolRelay` `run-plan.ts:447`) | the watcher, execution dispatch, `permissions.decide` defense-in-depth | none |
| Responder seam (`acp-interactions.ts`) | nothing | all pause/park/reply mechanics | envelope detection + tool-call id normalization at the top of `handleRequest` + `GateDescriptor` from envelope with runner-side spec lookup + card payload synthesis + malformed-envelope reject |
| Reply mapping (`responder.ts`) | nothing | everything (`decisionToReply` is already correct; the daemon maps `{once, always, reject}` to the dialog option by kind) | nothing |
| Park record (`sandbox_agent.ts`, `server.ts`) | nothing | everything | `gateType` union widened to include `"pi-dialog-permission"` (`sandbox_agent.ts:368`) + the `server.ts:628` gate-type guard accepts it + envelope identity in `parkedApproval` |
| Stored decisions (`responder.ts` `ConversationDecisions`) | nothing | keying (name + canonical args), `take`/`peek` | a FIFO append API; consume-1-append-1 on the cold dialog path; warm-resume seeding (verify `extractApprovalDecisions`, else an explicit resume-branch append) |
| Config | nothing | `AGENTA_RUNNER_SESSION_KEEPALIVE`, TTLs, pool cap | `AGENTA_RUNNER_PI_DIALOG_GATE` -> sandbox `AGENTA_AGENT_PI_DIALOG_GATE` via `buildPiExtensionEnv` (`pi-assets.ts:67-78`); default off, flip after slice 4 greens |
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
  classification (envelope vs non-matching title), tool-call id normalization everywhere the
  id is read, runner-side spec lookup parity (author-allow instant, author-deny instant,
  read-only builtin auto-allow), malformed-envelope reject (fail closed), decisions FIFO
  append + consume-1-append-1 accounting, client-spec exclusion from the dialog gate.
- Dispatch (fake session): Pi ask parks; resume-approve runs original call once (instant AND
  warm-resume decision seeding for the relay's second check); resume-deny blocks; TTL expiry
  -> cold; approval-mismatch evicts; multi-gate refuses the park and degrades cold
  (`server.ts:407` behavior, harness-agnostic).
- Wire contract: assert no `/run` or `interaction_request` shape change (existing tests).
- Live (slice 4): the matrix above on the dev box, plus the pinned replay regressions.
