# Phantom execution: approved tool calls that never run

Third finding in the playground approval saga. Read-only investigation, 2026-07-06.
Companions: `docs/design/agent-workflows/scratch/approval-turn-duplication-findings.md`
and `docs/design/parallel-approval-gates/research.md`.

## Symptom

Session with harness `claude`, runner `sidecar`. The model called the gated platform
tools `mcp__agenta-tools__commit_revision` and later `create_subscription`. The user
approved each one in the UI. After resume, the model said "The agent revision is
already saved with those values" and later "The subscription is active now." It never
visibly re-issued `commit_revision`. In reality, no revision commit exists and no
subscription exists. The user approved, the UI showed approved, the agent claimed
done, and nothing ran.

## How execution is supposed to happen (the path as it actually is)

The key fact first: **the runner never executes an approved call itself.** Approval
resume works only if the model re-issues the same tool call on the fresh session. The
stored approval then answers the re-raised permission gate. If the model does not
re-issue the call, the approval sits unconsumed and nothing executes. There is no
proactive execution path anywhere in the runner.

Step by step:

1. Turn 1: the model calls the gated tool. The ACP gate reaches
   `attachPermissionResponder` (`services/runner/src/engines/sandbox_agent/acp-interactions.ts:204-214`).
   No stored decision exists, so `decide()` returns `pendingApproval`
   (`services/runner/src/permission-plan.ts:138-151`). The runner emits an
   `interaction_request`, never replies to the gate, and destroys the session
   (F-040 pause, `services/runner/src/engines/sandbox_agent/pause.ts:22-27`,
   `acp-interactions.ts:73-95`).
2. The user approves. The AI SDK flips the tool part to `state: "approval-responded"`
   with `approval: {approved: true}` and auto-resends the FULL history as a new POST
   (`web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:108-138`).
3. SDK ingress folds that part into TWO content blocks: a `tool_call` block (name +
   input, `sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:119-127`) and a
   `tool_result` block whose output is the envelope `{"approved": true}`
   (`messages.py:151-181`, emit at 174-181). Note: the decision becomes a
   **tool_result on the same toolCallId**, indistinguishable downstream from a real
   tool output except by its shape.
4. The runner builds the decision store from the inbound history:
   `extractApprovalDecisions` (`services/runner/src/responder.ts:247-259`) finds every
   `tool_result` whose output is an `{approved: boolean}` envelope
   (`approvalDecisionOf`, `responder.ts:344-358`), recovers name + args from the
   matching `tool_call` block (`coldReplayKey`, `responder.ts:322-332`), and keys it by
   `approvedCallKey(name, args)` (`responder.ts:65-76`). Wired at
   `services/runner/src/engines/sandbox_agent.ts:731-744`.
5. The runner cold-starts a fresh sandbox and replays prior turns as flattened text:
   `buildTurnText` (`services/runner/src/engines/sandbox_agent/transcript.ts:69-81`)
   over `messageTranscript` (`transcript.ts:43-63`). The stored decisions are NOT used
   here. They wait, passively, for a live gate.
6. **Only if** the model re-issues the same call: the harness raises a new gate,
   `decide()` consults the store (`permission-plan.ts:147-149`,
   `ConversationDecisions.take` at `responder.ts:148-155`), gets `allow`, and
   `replyPermission` answers the gate with `"once"`
   (`acp-interactions.ts:123-141`, reply mapping `responder.ts:370-378`).
7. Claude then executes the MCP tool for real: `tools/call` to the internal loopback
   MCP server (`services/runner/src/tools/tool-mcp-http.ts:152-234`) →
   `runResolvedTool` (`services/runner/src/tools/dispatch.ts:224-273`) → file relay
   (`dispatch.ts:66-111`) → relay loop (`services/runner/src/tools/relay.ts:463-513`)
   → `callAgentaTool` POST to Agenta's `/tools/call` (`relay.ts:305`). Failures come
   back as MCP `isError` results the model can see (`tool-mcp-http.ts:219-234`).

Step 6 never happened in this session. The model skipped the re-issue, so the chain
stopped at step 5.

## What the model sees on replay (the root cause)

`messageTranscript` renders content blocks like this (`transcript.ts:51-55`):

- `tool_call` → `[called mcp__agenta-tools__commit_revision({"name":"...","parameters":{...}})]`
- `tool_result` → `[mcp__agenta-tools__commit_revision returned: {"approved":true}]`

So the approved-but-never-executed call appears in the replayed transcript as:

```
assistant: ...reasoning text... [called mcp__agenta-tools__commit_revision({...args...})]
[mcp__agenta-tools__commit_revision returned: {"approved":true}]
```

That reads as a **completed call with a successful-looking result**. `"approved":
true` looks like a success payload. Nothing says "this call has not run yet" or
"re-issue this call to execute it." The whole resume design depends on the model
re-issuing the call, and `research.md` section 6 states that assumption outright
("The model re-issues the approved call"), but the transcript actively tells the model
the opposite. So the model reasonably answers "the revision is already saved" and
moves on. The stored decision is never consumed. Nothing executes. Phantom success.

Two aggravators make it worse:

- **The approval envelope re-folds forever.** The FE part stays
  `approval-responded` (no output ever arrives to flip it), so every later request
  re-emits the same `{approved: true}` result into history and the transcript. The
  claim of completion compounds each turn.
- **The duplicate-turn bug (finding 1) multiplies the evidence.** Each resume clones
  the whole assistant turn into a new message, so the replay can contain the same
  `[called ...] [... returned: {"approved":true}]` pair several times. Several
  "records" of the call makes "it already ran" even more plausible to the model.

## The create_subscription case (secondary check)

The transcript sequence fits the same cause, twice over:

1. Turn 1: both tools gated in parallel. `commit_revision` wins the pause latch;
   `create_subscription` is dropped (`acp-interactions.ts:78`) and the FE later
   force-settles it with the fake error `This app can't handle the
   "mcp__agenta-tools__create_subscription" request.` (finding 2).
2. Resume 1: the replay shows `commit_revision` "returned {approved:true}" (never
   re-issued, phantom no. 1) and `create_subscription` with a real error result. The
   model retries `create_subscription` because the error is the one honest signal in
   the transcript. New live gate, no stored decision for it, second approval prompt.
   This is why the re-issue happened for this tool only: an error result reads as
   "not done," an `{approved:true}` result reads as "done."
3. Resume 2: history now holds `create_subscription` in `approval-responded`. Replay
   renders `[mcp__agenta-tools__create_subscription returned: {"approved":true}]`.
   Same trap: the model treats it as executed and says "The subscription is active
   now." Phantom no. 2. No third gate ever fired, so the stored decision was never
   consumed and `/tools/call` was never hit.

Had the model re-issued after resume 2, the path in step 6-7 above is sound: the gate
answers `"once"` from the store and Claude executes the MCP call over the live
loopback server; an API failure would surface as an `isError` tool result the model
sees. The only known answered-but-lost gap is the documented pause race: on
pause/teardown the abort signal destroys in-flight MCP sockets while a dispatched
`runResolvedTool` keeps running server-side and its result is dropped
(`tool-mcp-http.ts:66-72` and `381-394`). That produces the inverse bug (executed but
unreported), not this one, and there is no transcript evidence it fired here.

## Failure mode classification

- **(a) Model assumes success from the replay, never re-issues, decision never
  consumed.** Likelihood: near certain, for both tools. The transcript quotes match
  exactly what a model would say after reading `returned: {"approved":true}`
  ("already saved," "active now"), the model never re-issued `commit_revision` at
  all, and the code shows no other execution path exists.
- **(b) Gate answered but execution lost.** Likelihood: very low here. It requires
  the model to re-issue (it did not for `commit_revision`), and a re-issued call
  either executes or returns a visible `isError` result. The pause-race result-drop
  exists but produces executed-but-unreported, the opposite symptom.
- **(c) Executed but side effect landed elsewhere.** Likelihood: very low. The relay
  binds the call to the run's own callback endpoint and auth (`relay.ts:280-307`); a
  wrong-target write would still leave SOME commit or subscription, and none exists.

## Fix directions

Where the fix lives, by layer, roughly in order of value:

1. **Render the approval envelope honestly in the replay transcript** (runner,
   small). In `messageTranscript` (`transcript.ts:53-55`), detect the
   `{approved: boolean}` envelope (reuse the shape test in `approvalDecisionOf`,
   `responder.ts:344-358`) and render something like
   `[user APPROVED mcp__agenta-tools__commit_revision({...args}); the call has NOT
   run yet. Call the tool again with the same arguments to execute it.]` and the
   deny twin for `approved: false`. One file plus a helper export and unit tests.
   Risk: a real tool whose genuine output is `{approved: true}` would be
   misrendered; the shape is narrow and the same ambiguity already exists in
   `extractApprovalDecisions`, so this adds no new confusion.
2. **Nudge the model in the turn text** (runner, small-medium). `buildTurnText`
   (`transcript.ts:69-81`) can append an explicit list: approved calls that have no
   real (non-envelope) `tool_result`, told to the model as "approved and pending
   execution, re-issue now." The runner already computes exactly this set
   (`extractApprovalDecisions` keys). Belt to fix 1's suspenders; makes the re-issue
   an instruction, not an inference.
3. **Proactive execution at resume** (runner, large). Execute each approved call
   directly from history before or instead of waiting for a re-issue, then inject a
   synthetic real `tool_result` into the stream and history. Removes the dependence
   on model cooperation entirely, but changes the HITL contract: the runner must
   resolve the spec, run `/tools/call`, emit egress frames for a call the live
   harness never made, and reconcile if the model re-issues anyway (double
   execution risk). Needs a design pass; do not rush this one.
4. **Distinguish the envelope on the wire** (SDK + runner, medium). Instead of
   folding the decision as a plain `tool_result` (`messages.py:174-181`), mark it
   (a distinct block type or a flag). Downstream consumers (transcript,
   `extractApprovalDecisions`) then match on the marker, not on the output shape.
   Touches `protocol.ts`, `wire.py`, and the golden contract fixtures.
5. **Detection/telemetry** (runner, small). Log when a turn ends with stored
   decisions never taken (`ConversationDecisions` knows). Turns future phantoms
   into a greppable `[HITL]` line instead of a user report.

Model-instruction-only fixes (system prompt text) are not enough on their own; the
per-turn transcript is where the contradiction lives, so fix it there.

## Open questions

- Does Claude reliably re-issue after fix 1 or 2, or does it sometimes ask the user
  instead? Needs a live QA cell on the approval matrix.
- Args drift: the stored key is `approvedCallKey(name, args)`. If the re-issued call
  varies its args even slightly (or the FE persisted `{}` input, as finding 2 saw for
  the dropped sibling), the decision misses and the user gets re-prompted. Safe but
  annoying; worth a `[HITL]` log when a re-issued gate near-misses a stored key.
- Should fix 1 also cap or dedupe the replay when the duplicate-turn bug (finding 1)
  has cloned the same call several times, or do we rely on that bug's own fix?
- Pi relay path: Pi folds the same `{approved}` envelope through the same transcript.
  The relay answers gates differently, but the phantom-success reading of the replay
  applies there too; verify once on Pi.

## Hotfix round (2026-07-06, live testing of the first fix)

Live testing of the honest-replay fix surfaced an approval LOOP, the args-drift open
question above made real. The model re-issued `commit_revision` but copied the args off
the flattened text transcript, re-serializing the object-valued `workflow_revision` as a
JSON string. The exact-args key missed, the runner raised a NEW gate, and every resume
added one more stale "NOT run yet, call it again NOW" envelope (approval-responded parts
never leave that state and re-fold on each request), so the loop compounded: approve →
resume → re-issue with drifted args → new gate → approve again.

Two fixes landed on the same lane:

- **Tolerant canonicalization (`responder.ts`):** `canonicalJson` now runs a
  `normalizeJsonish` pre-pass — any string value that parses as a JSON object/array is
  replaced by the parsed value, recursively, before the key-order-insensitive stable
  stringify. Both sides (history extraction and live gates) share the path, so
  `{"workflow_revision": "{\"delta\":…}"}` and `{"workflow_revision": {"delta":…}}`
  produce the same key. No name-only fallback: semantically different args still miss.
- **Smart envelope rendering (`transcript.ts`):** a pre-pass (`approvalRenderHints`)
  over the whole prior history classifies each allow-envelope: rendered as
  `[user APPROVED T; executed below]` when a later real (non-envelope) result for the
  same tool exists (tool-name approximation, rendering only); the "call it again NOW"
  nudge only on the LAST unresolved envelope per tool; older unresolved duplicates as a
  neutral `[user approved T earlier.]`. Deny rendering unchanged.

Verified live (claude/sonnet, self_managed sidecar): one approval, one re-issue, gate
`outcome=allow` from the stored decision, revision v3 landed, and the next turn replayed
without a nudge (plain answer, no gate). Unit-pinned in `responder.test.ts` (JSON-string
drift matches, different args still miss, end-to-end `ConversationDecisions.take`) and
`transcript.test.ts` (executed-below, single-nudge, cross-tool isolation, deny
unchanged).
