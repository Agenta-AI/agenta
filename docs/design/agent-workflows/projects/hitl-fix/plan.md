# Plan: smallest-correct HITL fix

The renderer, the egress, and the cross-turn resume are already correct (see research.md). The
fix is to stop the runner from poisoning the wire when it parks an `ask` gate. Below is the
layer-by-layer change, smallest first, plus the Pi decision and the test plan.

## The core fix (runner): park without poisoning the tool

When `HITLResponder` decides to PARK (human surface, no stored decision), the runner must end
the turn WITHOUT producing a failed `tool_result` for that `toolCallId`, so the
`approval-requested` part is the last word on that tool call.

Today park = reply `reject` to the harness, which makes Claude emit a failed tool call. Two
viable approaches; the design recommends Approach A and keeps B as the fallback if A proves
harness-fragile.

### Approach A (recommended): a distinct PARK decision; do not reply `reject` on park

Introduce a third responder outcome alongside `allow` / `deny`: `park`. On `park`,
`attachPermissionResponder` does NOT call `session.respondPermission(...)` for that gate at all
(or replies with a cancel/no-op the harness treats as "end turn pending", per the ACP
capability). The turn ends with the gated tool un-run and no failed `tool_result` emitted. The
`interaction_request` event (already emitted before the decision) is the final state for that
`toolCallId`, so the egress's `tool-approval-request` survives to the FE.

Files:

- `services/agent/src/responder.ts`
  - Widen `PermissionDecision` to `"allow" | "deny" | "park"` (or add a sibling return type so
    `decisionToReply` only ever sees `allow`/`deny`). `HITLResponder` returns `"park"` in the
    branch that today returns `"deny"` for the human surface (`:90`). `PolicyResponder` and the
    headless branch are unchanged (still `allow`/`deny`), so `/invoke` is byte-identical.
  - `extractApprovalDecisions` / the resume path is unchanged: a stored `allow`/`deny` still
    short-circuits before park.
- `services/agent/src/engines/sandbox_agent/permissions.ts`
  - On `park`, skip `respondPermission` (the turn ends with the tool pending) — or, if the
    harness requires an answer to unblock the turn, reply with the ACP "cancel"/"defer" reply
    when offered, NEVER `reject`. Add a comment citing this finding so it is not "simplified"
    back to `reject`.
- `services/agent/src/responder.ts` `decisionToReply` stays `allow`/`deny` only (park never
  reaches it).

Open verification (empirical, needs the live harness): confirm that ending the turn without a
`reject` reply does not leave Claude blocked awaiting a permission answer. If the ACP session
requires a terminal answer per request, use the harness's cancel/abort reply on park rather
than no reply. This is the one harness-behavior unknown; the test plan's live step pins it.

### Approach B (fallback): suppress the park-induced failed tool_result in the event layer

Keep park = `reject` to the harness, but teach the runner to drop the resulting failed
`tool_result` for a `toolCallId` that has an outstanding parked `interaction_request`. The
responder records the parked `toolCallId`s; `maybeCloseTool`
(`services/agent/src/tracing/otel.ts:1040-1054`) checks that set and, when a `failed` update is
the "User refused permission" refusal for a parked call, records nothing (or records a neutral
`approval-pending` marker) instead of `tool_result {isError:true}`.

Downsides vs A: it pattern-matches the refusal text/timing, couples the otel layer to the
responder, and leaves a `reject` going to the harness (which may also abort the turn in a way
that breaks resume). Prefer A; keep B only if A cannot end the turn cleanly.

## Egress (Layer 2): no change expected

`stream.py` already emits `tool-approval-request` for `interaction_request` kind `permission`,
and already has `tool-output-denied` for an explicit deny. Once the runner stops emitting the
clobbering `tool-output-error` on park, the existing egress is correct. One guard to ADD:
ensure that when a turn ends with an outstanding approval request and no resolution, the egress
does NOT emit a `finish` that the FE would read as "tool failed" — verify the parked turn's
`finish` carries a benign `finishReason` (e.g. `tool-calls`/`unknown`, never `error`). This is
assertion-only unless the trace shows otherwise.

## Frontend (Layer 3): no change expected for F-024

`ToolPart.tsx` already renders Approve/Deny for `approval-requested` and `AgentChatPanel`
already auto-resumes. No change is required to fix the Claude path once the wire is correct.

Two adjacent FE items to fold in as small follow-ups (NOT required for the core fix, but cheap
and in the same area):

- Confirm the auto-resume path (`sendAutomaticallyWhen`) re-sends the conversation with the
  `tool-approval-response` part so `/messages` + `extractApprovalDecisions` resolves it. This is
  wired; the test plan exercises it live.
- F-025 (duplicate React keys) is a separate finding in the same component tree; out of scope
  here, noted so the two are not conflated.

## Pi HITL (Layer 4): the decision

Pi has no permission gate (`permissions: false`; `permissionPolicy` hardcoded `auto`). The
form offering `ask` for Pi would be a lie unless the runner enforces it. Two honest options:

- **Option Pi-1 (recommended now): hide `ask` for Pi.** Keep `PermissionPolicy` as
  `auto`/`deny` for the harness gate, and in `AgentConfigControl.tsx` grey out / omit the
  policy field (or the `ask` option) when the harness is Pi, with helper text "Pi runs tools
  without prompting; use per-tool permission for gating" once relay HITL exists. Truthful,
  tiny, ships with the Claude fix.
- **Option Pi-2 (follow-up, larger): enforce `ask` for Pi via the relay.** Build relay-tool
  park/emit/resume (open-issues S5.2): when a resolved `code`/gateway tool has `permission:
  "ask"`, the relay emits an `interaction_request` keyed by the tool-call id, ends the turn
  without writing the relay response file, and resumes from the stored decision on the next
  turn. This is the only way Pi can do HITL (Pi gates nothing itself; only the relay sits
  between Pi and a resolved tool). It needs a turn-boundary model in the relay and is tracked
  as its own slice.

Recommendation: ship Pi-1 with the Claude fix; track Pi-2 as the real Pi HITL path. Note the
per-tool `permission: "allow" | "ask" | "deny"` field already exists on `ResolvedToolSpec`
(`protocol.ts:83`) and on MCP servers, so Pi-2 is "enforce the field at the relay", not "add a
field".

## Test plan (FE + SDK + runner)

### Runner unit (vitest, `services/agent/tests/unit`)

1. `responder.test.ts`: `HITLResponder` with a human surface and no stored decision returns
   `park` (not `deny`); with a stored `allow`/`deny` returns it; headless (no surface) returns
   the base policy. (Updates the existing park test to the new outcome.)
2. `permissions.test.ts`: on a `park` decision, `attachPermissionResponder` emits the
   `interaction_request` event and does NOT call `respondPermission` with `reject` (assert the
   fake session's `respondPermission` is not called with `reject`, or is not called at all).
3. New regression guard: drive a fake ACP session that, on a parked gate, would emit a
   `failed` `tool_call_update`; assert the runner does NOT emit a `tool_result {isError}` for a
   parked `toolCallId` (Approach A makes this vacuous because no reject is sent; under B it
   asserts the suppression).

### SDK contract / egress (pytest, `sdks/python/oss/tests/pytest/unit/agents`)

4. `stream.py` egress test: a run whose events are `[tool_call, interaction_request(permission),
   done]` (NO error tool_result) produces a stream containing exactly one
   `tool-approval-request` for that `toolCallId` and NO `tool-output-error` for it. (Locks the
   "park does not clobber" contract at the egress.)
5. `messages.py` ingest test (already covered, assert it stays green): an inbound
   `tool-approval-response {approved:true}` becomes a `tool_result` block with
   `output:{approved:true}`, and `extractApprovalDecisions` resolves it to `allow`.

### Golden wire (if any wire field changes)

6. If `PermissionDecision`/`park` stays runner-internal (recommended), NO golden/`wire.py`
   change. Confirm `protocol.ts` `AgentEvent` is unchanged so the golden fixtures and
   `test_wire_contract.py` / `wire-contract.test.ts` stay green without edits. (Park is a
   runner-internal decision, not a wire value.)

### Live end-to-end (the empirical proof, via the agent sidecar)

Run against a live sidecar (EE-dev compose `:8280`; see `agent-workflows-qa` /
`debug-local-deployment`), Claude harness, a model with credit, an `ask` rule matching a tool.
This pins the one harness-behavior unknown (does park end the turn cleanly).

7. POST `/messages` (session S) forcing the gated tool. Assert the stream contains
   `tool-approval-request` and NO `tool-output-error`/`tool-output-available` for that tool
   (it did not run). In the playground, assert the inline Approve/Deny prompt renders.
8. Approve: the FE auto-resume re-POSTs `/messages` (same S) with the
   `tool-approval-response {approved:true}`. Assert turn 2 re-raises the gate, the stored
   decision resolves it to `allow`, the tool runs (a real `tool-output-available` appears), and
   the final reply is the agent's (e.g. `HITL-DONE`).
9. Deny in a fresh session: assert the tool stays un-run and the model continues without it
   (`tool-output-denied` or no tool output, no ERROR card).

If step 8's turn 2 does NOT re-raise the gate after a cold replay (the model may not re-issue
the identical call), fall back to the runner replaying the approved tool's result directly into
the transcript rather than relying on the harness to re-ask. This is the open question already
logged in open-issues ("Live multi-turn HITL round-trip is unverified"); this plan's live test
is exactly the experiment that settles it. Capture the result in status.md either way.

### Pin a replay regression

10. Once step 8 is green, capture the `/run` pair and write an `agent-replay-test` so the
    park→approve→resume round-trip replays forever without a live LLM (locks SDK + runner
    behavior).

## Smallest-change summary

- Runner: add a `park` outcome; on park, do not send `reject` (Approach A). ~1 file of real
  logic (`responder.ts`) + the `permissions.ts` wiring + comments.
- Egress: no change (assertion-only test additions).
- FE: no change for F-024 (assertion via the live test).
- Pi: hide `ask` for Pi in the form (Option Pi-1); track relay enforcement (Pi-2).
- Tests: 1 updated + ~4 new unit/contract tests + 3 live cells + 1 replay pin.
