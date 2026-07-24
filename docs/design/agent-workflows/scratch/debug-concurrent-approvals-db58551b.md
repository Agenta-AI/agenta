# Root-cause report: concurrent human-approval failure (session db58551b)

This report explains why Mahmoud's live QA of two parallel gated writes broke: the first
approved command was reported as "not executed", the conversation went dead after the second
approval, the first approval card flipped back to "waiting", and a follow-up message was
answered with "Done" instead of being read. Every claim below is verified against two
independent evidence sources: the persisted session dump
(`debug/session-db58551b.json`) and the runner container's timestamped logs
(`agenta-ee-dev-wp-b2-rendering-runner-1`, 09:51 to 09:56 UTC on 2026-07-19). Where the two
sources disagree, the logs win, because the session record turns out to rewrite itself (see
defect 5).

## Orientation: the moving parts

- **The runner** is the Node/TypeScript sidecar under `services/runner/`. It drives a
  coding-agent harness (here Pi, whose tool calls carry OpenAI-style `call_...` ids) inside a
  sandbox and streams events to the web UI.
- **A gate** is a human-approval request. When Pi wants to run a policy-gated builtin tool
  (here `Bash`), our Pi extension's hook calls `ctx.ui.confirm` and waits
  (`extensions/agenta.ts`, `piDialogAllows`). The hook is fail-closed: only an explicit
  `true` lets the command run. The pi-acp bridge surfaces the confirm as an ACP
  `session/request_permission`, which the runner classifies and shows to the user as an
  approval card (`acp-interactions.ts`).
- **Park and warm resume.** When a gate has no answer, the runner ends the turn and "parks"
  the live harness session in a keepalive pool (`server.ts`, `parkedApprovals`). When the
  answer arrives, the runner checks the session back out and continues it in place; this is a
  **warm resume** (`[keepalive] resume` in the logs). Every post-approval turn in this
  session was a warm resume: tool-call ids are reused across turns, and the resumed turns
  re-emit cached usage rather than making a new model call.
- **The cold path is native continuation, not replay.** On a keepalive miss the runner
  builds a fresh environment, but the harness resumes its OWN session, located through the
  harness session id the runner persists per turn
  (`session-continuity-durable.ts`, `fetchLatestSessionTurn`). The model does not re-issue
  tool calls. Replaying the conversation from our persisted event stream happens only as a
  last-resort fallback when that continuity lookup fails. Neither cold tier was involved in
  this incident.
- **The deferred-sibling sentinel.** `TOOL_NOT_EXECUTED_PAUSED` (`tracing/otel.ts:66`) is the
  string `"DEFERRED_NOT_EXECUTED: paused for another approval; retry the same call if still
  required."`. After a pause, `settleOpenToolCalls` (`tracing/otel.ts:1479`) stamps it onto
  every still-open tool call not excluded by a predicate; the only exclusion today is "this
  call is itself a paused gate" (`run-turn.ts:505`, predicate `pause.isPausedToolCall`).
- **Pi serializes confirms.** Throughout this session, Pi raised one `ctx.ui.confirm` at a
  time. The second parallel call's confirm only surfaced after the first call's confirm was
  answered, one park/resume cycle later. Two approval cards were therefore never truly
  outstanding at the same moment on the runner; the user experienced them as one card per
  cycle. This matches the adapter-serialization finding tracked in issue #5391.

## The verified timeline

The model issued two parallel `Bash` calls at 09:53:20: `IRll` (append a line to
`agent-files/README.md`) and `VIgq` (append the same line to `agent-files/NOTES.md`).

1. **Turn 1 (09:53:20).** Pi raised the confirm for `IRll` only. The runner gated it (card
   `f6f8384d`), parked, and the turn ended. `VIgq`'s confirm was never raised in this turn.
   Twenty milliseconds after the park, a `tool_result` for `VIgq` was persisted with output
   `"(no output)"` and `isError: false`: a successful-looking result for a command that had
   not run and had never been approved. No gate, no execution, no bash activity for `VIgq`
   appears anywhere in the logs for this turn.
2. **Turn 2 (09:53:22, warm resume after the user approved card 1).** The runner answered
   `IRll`'s confirm with `once`. One millisecond later Pi raised the confirm for `VIgq`; the
   runner gated it (card `b5f44eb8`) and parked again. The post-pause sweep then stamped
   `TOOL_NOT_EXECUTED_PAUSED` onto `IRll`, the call the user had just approved, because the
   sweep's exclusion list contains only paused calls and `IRll` was "approved and executing",
   a state the sweep does not know about. `IRll`'s real completion arrived after the park and
   was discarded (late events are dropped once the turn is cleared,
   `session-events.ts:31`). The README append itself almost certainly executed on the
   sandbox: the confirm resolved `true`, execution is never cancelled in park mode, and
   nothing in the logs shows a failure. Only its report was destroyed.
3. **The dead hour of the session (09:53:22 to 09:54:17).** The user approved card 2 in the
   UI. The logs show NO resume request arriving in this window. The click was recorded only
   in the browser's local state. The frontend's auto-resume fires only when every approval
   card on the last turn looks settled (`agentApprovalResume.ts:163`), and the re-rendered
   state showed card 1 as pending again, so the auto-resume never fired. Card 1 looked
   pending because nothing in the persisted record says a gate was ever answered (defect 4).
4. **Turn 3 (09:54:17, triggered by the user's text message).** The frontend bundled the
   stored card-2 approval into the message request (`[keepalive] resume gates=1 approve=1`).
   The runner used the request as an approval resume: it answered `VIgq`'s confirm, `VIgq`
   executed (approved, at 09:54:17), and the model then continued the parked write task and
   replied "Done - two separate write requests ran in parallel". The user's actual questions
   were not answered; the turn was a resume of the stale task, not a reading of the new
   message.

Net effect on disk: both appends executed exactly once, each only after its approval. There
was NO unapproved execution in this session. What broke was reporting, state
reconstruction, and the resume trigger, plus a latent hazard described under defect 2.

## Defects

### Defect 1: the frontend never dispatches the resume for the last answered card

The user's click on card 2 produced no network request. The decision sat in browser state
until the next message happened to carry it. Root cause: the auto-resume precondition
"every card settled" (`web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:163`)
can never hold after a state rebuild, because the persisted record contains the request half
of every gate and never the answer half (defect 4). This is what killed the conversation and
what made card 1 flip back to "waiting for approval".

### Defect 2: the post-pause sweep clobbers an approved, executing call

`run-turn.ts:505` sweeps every open call except currently-paused gates. A call that was just
approved on this resume and is mid-execution is not in that exclusion, so it gets stamped
`TOOL_NOT_EXECUTED_PAUSED` (`isError: true`) and its real result is dropped when it lands
late. Two consequences: the user sees their approved command reported as never executed, and
the sentinel's text invites the model to "retry the same call", which for a
side-effecting command that DID execute means a double execution. The model happened not to
retry in this session; nothing prevents it. The sweep predicate and the one-tick drain
(`pause.ts`, a single `setImmediate`) are pre-existing on `origin/main`; the #5382 lane's
warm re-park (commits `ab3c7819bb`, `0071f90090`) is what creates the state "approved and
executing while a new gate pauses the same turn" that exposes them.

### Defect 3: a never-started sibling is recorded as a successful "(no output)" result

In turn 1, `VIgq` had not started (its confirm was still queued inside Pi), yet a
`completed` frame closed it as a success. The frame-suppression policy deliberately lets
`completed` frames through during a pause so that a legitimately finishing auto-allowed
sibling keeps its real result (`runtime-policy.ts:45`); a cancellation-closure frame for a
never-started call takes the same path and is indistinguishable there. The result mapping
then records any `completed` frame as `isError: false` (`tracing/otel.ts:1445`). The exact
emitter of that closure frame (pi-acp's turn-cancellation path closing unstarted calls) is
the one link not pinned to a line; everything downstream of the frame is verified. The
correct record for that call at that moment is the deferred sentinel, not a success.

### Defect 4: the answer half of a gate is never persisted

The runner protocol has an `interaction_request` event and no answer event
(`protocol.ts:358`); a full-repo search finds no `interaction_response` producer. The
interactions table gets its row flipped to resolved (`interactions.ts:97`) but the payload
carries only lifecycle status, not the allow/deny verdict, even though the API schema has a
`resolution` field for it (`api/oss/src/core/sessions/interactions/dtos.py:24`). The live UI
tracks answers only in local memory (`AgentConversation.tsx:1031`); hydration reads only
session records (`loadSession.ts:20`) and reconstructs every persisted request as pending
(`transcriptToMessages.ts:144`). Every rebuild therefore resurrects answered gates. This is
the root that feeds defect 1, and it is also an audit gap: the record cannot say who
approved what.

### Defect 5: the persisted session record rewrites itself

Tool-result rows are stored under deterministic ids keyed by session, tool-call id, and
event type, with no turn scoping (`persist.ts:295`). A later result for the same call
overwrites the earlier row in place, preserving `created_at`. In this session, `VIgq`'s real
09:54:17 result silently replaced its turn-1 artifact row. The exported dump therefore
misrepresents history, which is how it initially supported a false "unapproved execution"
reading. Separately, an approval resume re-persists the recovered prior prompt as a fresh
user-message row (`server.ts:1004`), which is why "no i want to write requests in parallel"
appears twice in the record. The session record is currently not a trustworthy audit log.

### Defect 6: a text message during a park is consumed as an approval resume

A message request that arrives while gates are parked goes down the approval-resume branch
(`server.ts:663`). In this session it carried a bundled decision, matched, and warm-resumed
the stale task; the model completed the old work and never addressed the new text. Had it
carried no decision, the branch would have evicted the parked session and continued on the
cold path, with the same user-visible outcome (the stale task finishes, the question is
ignored). The
dispatch does not distinguish "this request answers the gates" from "this is new user text
that should supersede or queue behind the parked work".

### Defect 7 (found in passing): session-turns append fails with HTTP 500

`[sandbox-agent] append HTTP 500 ... harness=pi_core turn=0` recurs throughout the logs on
this stack. The new append-only `session_turns` ingestion is failing for Pi sessions. This
is unrelated to approvals but means the new sessions plane is silently not recording these
turns. It needs its own investigation.

## Fix plan, in order

1. **Persist the answer half of every gate (fixes defects 4 and, through it, 1).** Emit an
   answer event into the session record when a gate is resolved, and store the allow/deny
   verdict in the interaction row's `resolution`. Hydration then overlays answers onto
   requests, rebuilt state shows answered cards as answered, and the frontend's auto-resume
   condition can become true. This is the smallest change that revives the dead conversation
   and the flip-flopping cards. Add a frontend fallback so an answered card's decision is
   dispatched even if other cards look unsettled, so one rendering bug can never strand a
   decision in browser memory again.
2. **Protect approved, executing calls from the sweep, and let their real result land
   (fixes defect 2).** Carry "approved this resume" ids into the pause controller's
   exclusion set, and hold the turn's terminalization until those calls reach their own
   terminal frame (bounded by the existing per-call time limit) so the real result replaces
   nothing and the sentinel is never written onto them. The retry-inviting sentinel must
   never be attached to a call whose execution actually started.
3. **Record a never-started sibling as deferred, not as success (fixes defect 3).** During a
   pause, buffer `completed` frames for sibling calls until the drain settles which calls
   gated; a closure frame for a call that never started becomes the deferred sentinel, a
   genuine completion keeps its real result.
4. **Separate "answer the gates" from "new user text" in the parked dispatch (fixes defect
   6).** An incoming request with fresh text should either abandon the parked task cleanly or
   queue the text as the next turn after the resume completes; it must never vanish into a
   resume of stale work. This is partly a product decision and can land after 1 to 3.
5. **Make the session record append-only per turn (fixes defect 5).** Scope stable
   record ids by turn so contradictory results append rather than overwrite, and stop
   re-persisting the recovered prompt on approval resumes. Needed for trustworthy audits and
   for debugging every future incident.
6. **Investigate the session-turns HTTP 500 (defect 7)** as its own thread against the new
   sessions ingestion.
7. **Add the missing regression test.** The existing tests model gates that are all known
   before the first pause. The real Pi shape is: two parallel gated calls, one gate raised,
   approve, second gate surfaces during the warm resume while the first command is still
   executing, approve, assert both side effects exactly once and both real results recorded.

## Open questions

- The precise emitter of the turn-1 closure frame for the unstarted call (pi-acp's
  cancellation path is the strong candidate; confirming it pins defect 3's upstream half).
- Whether the frontend should also dispatch each answer immediately as it is clicked
  (per-card dispatch) instead of batching until all cards settle; the Zed comparison report
  (`zed-acp-approvals-comparison.md`, in progress) should inform this.
- Whether Pi can be configured or extended to raise multiple confirms concurrently, which is
  the only path to two cards genuinely on screen at once (issue #5391).
