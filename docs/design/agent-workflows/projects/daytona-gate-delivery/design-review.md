# Design review

An independent staff-level review (Codex, xhigh reasoning, read-only on the repo) ran
against the first draft of this plan on 2026-07-11. Verdict: right direction, do not
approve as drafted. The findings below are folded into [options.md](options.md) and
[plan.md](plan.md). This file records what changed and why, so a reader can see the
plan's weak points and how they were closed.

## Findings folded into the plan

### 1. The approval state machine was hand-waved

The draft said an ask gate over the file relay "slots into the existing pause and resume
model." It does not. The relay loop stops as soon as the turn pauses
(`services/runner/src/engines/sandbox_agent.ts` around line 1713), the parked-approval
model only understands an ACP permission id answerable via `respondPermission`, and a
unit test asserts Pi file-relay gates are non-parkable
(`services/runner/tests/unit/session-keepalive-approval.test.ts` around line 428). The
plan now defines two explicit state machines (cold replay and live parking with a
file-transport parked-gate variant), plus idempotency, duplicate-answer, cancellation,
and late-result rules. See plan.md Phase 3.

### 2. Custom tools do not need a second gate channel

The draft routed Daytona custom-tool gates over a new gate-request file pair. Review
pointed out the custom tool already reaches the runner as an execution request, where the
relay guard re-runs policy (`sandbox_agent.ts` around line 1594). Making that existing
request the authorization seam (allow: execute; deny: return a denied result; pending:
emit the interaction and pause without executing) removes the fragile
gate-file/decision-file/execute-file/grant-ledger sequence entirely. The plan now does
that. The file gate exists only for residual builtins, which never reach the relay.

### 3. `ask | defer` was the wrong disposition vocabulary

`defer` is not a policy decision. The extension only needs `allow | deny | runner`, where
both ask and argument-dependent rules compile to `runner`. The compiler belongs in
`permission-plan.ts` next to `effectivePermission` and the rule matcher, not
re-implemented in `run-plan.ts`. Adopted.

### 4. A single gate timeout cannot tell delivery failure from a deliberating human

The draft gave every gate one bounded timeout. With one promise the extension cannot
distinguish "the request never reached the runner" (fail closed, the F-018 case) from
"the runner paused and the human is thinking" (must never be reaped; run-limits
deliberately freezes deadlines on pause). The plan now uses two lifetimes: a short
delivery deadline that ends at a runner acknowledgment file and fails closed, and a human
approval lifetime after acknowledgment governed by the existing pause and TTL model. On
the ACP confirm path no acknowledgment exists, so the plan no longer claims an all-path
timeout there. Late decisions after a delivery timeout get tombstone handling.

### 5. The decision file is forgeable where it matters most

The relay dir is sandbox-writable and the extension trusts relay response JSON
(`services/runner/src/tools/dispatch.ts` around line 89). That is fine for custom-tool
results because execution is runner-side behind the relay guard. For a builtin, an
`allow` decision file IS the authorization, and an unsigned file is not demonstrably
runner-authored. The plan now authenticates decision files with a per-run secret
delivered via a read-once file (the existing OTLP bearer pattern in `pi-assets.ts`), and
documents the narrowed threat model either way: builtin policy protects against the
model, not against an arbitrary hostile process inside the sandbox.

### 6. Phase 1 was not shippable alone

Under the default `allow_reads` policy, disposition injection alone makes reads work
while bash, edit, and write still hang (`runner`-routed with no working channel), and
custom-tool confirms stay broken. The phases are re-cut as one release unit: reproduction
and the policy compiler, the file transport with acknowledgment, relay-seam custom-tool
authorization, both resume state machines, the adversarial test set, and live Daytona
verification.

### 7. Interface sharpening

- Version the injected disposition map (`{"v":1,"builtins":{...}}`) and validate
  strictly: missing, malformed, unknown name, or grant/disposition mismatch routes to the
  runner or fails closed, never silently allows.
- Add an explicit `AGENTA_AGENT_GATE_TRANSPORT=acp|file` capability instead of letting
  the extension infer Daytona from a directory or provider name.
- Extract a shared identity validator from `pi-gate-envelope.ts` and define separate
  versioned ACP and file wrappers; do not reuse the ACP parser wholesale. The file
  protocol needs a collision-resistant request id, distinct suffixes, and a response
  status field.

## Review points not adopted, and why

None were rejected outright. One point is scoped rather than adopted in full: the review
suggests replay tests are supplemental because they cannot prove the Daytona SSE proxy
delivers reverse requests. Agreed, and the plan keeps them anyway as regression pins for
the runner-side logic, with live Daytona verification as the proof for the transport.
