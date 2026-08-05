# Options and recommendation

Both options fix the same root cause: the latch loser leaves an announced tool call
with no terminal state, and no layer downstream can tell the difference between "the
server is still working on it" and "the server abandoned it". The fix in both cases is
that the runner, at pause time, gives every announced call a truthful state before it
kills the session. Neither option touches the frontend's classifier or adds tool-name
lists anywhere.

## Option A: settle the losing sibling deterministically

### Mechanism

At `pause()` time, before `destroySession`, scan the run's event log
(`run.events()`, `otel.ts:1337`) for every `tool_call` id that has no matching
`tool_result` and is not the paused call (`pause.isPausedToolCall`). For each, emit:

```json
{"type": "tool_result", "id": "<toolCallId>", "isError": true,
 "output": "Not executed: the turn paused for approval of another tool call. Call the tool again if it is still needed."}
```

and close its open tool span. The natural home is a small method on the otel run
handle (it owns both the event log and `toolSpans`), for example
`run.settleOpenToolCalls(excludeIds, message)`, called from the pause controller's
destroy callback in `sandbox_agent.ts:710-715`. That seam covers every pause path
(ACP gate, Pi relay, client tool) with one hook.

This also fixes a wider case than the incident: ANY in-flight sibling call at pause
time (gated or not, for example a read tool mid-execution) is killed by the teardown
and currently orphans a part the FE then fake-fails. Option A settles all of them.

### Effects

- Frontend: part B settles as `output-error` with server text. The classifier never
  parks it (`meta.ts:64` requires unsettled), `UnhandledClientTool` never mounts, no
  fabricated error. Zero FE changes.
- Model: on resume, the transcript shows the deterministic error
  (`transcript.ts:53-55`); the model retries the tool; the user approves it second.
  Sequential approvals stay: same round-trip count as today, honest states.
- Wire contract: no new fields. Reuses the existing `tool_result` event and
  `tool-output-error` part. Golden fixtures unaffected.
- F-040: unchanged. Still no reply to any harness gate.

### Complexity and risk: SMALL

One helper plus wiring, runner-only, fully unit-testable with the existing fake
session in `sandbox-agent-orchestration.test.ts` (which already drives real pause
wiring, see its F-040 cases). Risks are minor: the error text becomes model-visible
prompt material (keep it short, stable, and directive), and the tool chip shows an
error state for something that is not the user's fault (copy can soften this; the
part-level UI treatment is a FE nicety, not a name list).

## Option B: batch all pending approvals into one pause

### The key research results (from research.md)

1. **You cannot collect gates by waiting.** The CLI serializes write tools; gate B is
   only raised after gate A resolves, which under F-040 means only inside the teardown
   race (§3). Batching must synthesize the sibling's approval from the runner's own
   record of the announced call, not from the ACP wire.
2. **ACP teardown handles N unanswered gates already.** The daemon holds pending
   permissions in a map and cancels all of them on session destroy
   (`chunk-TVCDKGSM.js:2215-2265`). No protocol obstacle.
3. **Our wire and client already support N approvals per message.** Multiple
   `tool-approval-request` parts are valid; the AI SDK flips each matching part
   independently (`ai dist:4775-4781`); the dock renders a queue with "1 of N" and
   "Approve all" (`ApprovalDock.tsx:35-47, 119-155`); the resume predicate holds the
   auto-resend until no gate is pending
   (`agentApprovalResume.ts:108-138`). All pre-built.
4. **Cold replay already consumes N decisions.** `extractApprovalDecisions` maps every
   `{approved}` envelope by name+args; each re-raised gate on replay is answered
   silently (`responder.ts:247-332`). So Mahmoud's hunch is right: batching is mostly
   about RECORDING all pending gates before teardown, not about holding sessions open.

### Mechanism

At `pause()` time, for each unresolved sibling `tool_call`:

1. Build a `GateDescriptor` from the recorded name and args (the same derivation
   `buildGateDescriptor` uses, including the `mcp__<server>__` server-permission
   parse, `acp-interactions.ts:238-275`).
2. Run `decide()`:
   - `pendingApproval` AND recorded args are trustworthy (non-empty, refreshed by the
     full-message `tool_call_update`): emit a synthetic
     `interaction_request` (kind `user_approval`, same payload shape as the Pi relay
     emission at `sandbox_agent.ts:777-792`), mark the id paused (suppresses teardown
     frames), and record the durable interaction.
   - anything else (verdict `allow`/`deny`, or args untrusted): fall back to
     Option A's deterministic settle.
3. Teardown as today. On resume, the history carries N approval envelopes; replay
   answers each re-raised gate; one round-trip total.

### Effects

- User: one approval interaction ("1 of 2" in the dock, or Approve all), one resume,
  both tools run. This is the actual UX win.
- Model: the replayed transcript shows both calls with `[... returned:
  {"approved":true}]`; the model re-issues both. If it re-issues with different args,
  the key misses and that gate re-pauses: graceful degradation to today's flow.
- Wire contract: still no new fields.
- F-040: unchanged. The synthetic gate is a runner-side event, not a harness reply.

### Complexity and risk: MEDIUM

Runner-only code again, but more of it, and two real risks:

1. **Args fidelity.** The sibling's real args ride a `tool_call_update` whose delivery
   races the pause (§4 of research.md; the incident lost that race). Without the
   refresh, Option B degrades to Option A for that call. A small pre-teardown drain
   (flush the ACP event stream for a bounded window, ~100-250ms, before
   `destroySession`) would make the refresh win almost always. That drain is the one
   genuinely new moving part and needs care (it must not delay pause on a dead
   daemon).
2. **Approving a call the harness never asked about.** The synthetic gate asserts
   "this tool will run if you approve". That promise holds because replay re-raises
   the gate and the stored decision only matches the same name+args. A mismatch never
   silently authorizes something else; it re-prompts. Worst case equals today.

Also needs: a multi-approval e2e pass (dock queue, Approve all, deny-one-approve-one),
and a decision on ordering (emit the harness gate's part first so the dock asks about
the call the model attempted first).

## A is a stepping stone to B

They are not alternatives; B contains A. B's fallback path for untrusted args and for
non-gated in-flight siblings IS Option A. Shipping A first fixes the phantom failure
immediately with small risk; B then upgrades trusted gated siblings from
"deferred error + retry + second prompt" to "batched approval + one prompt". No A code
is thrown away.

## Recommendation

1. **Ship Option A now.** It removes the fabricated failure, gives every part a
   truthful state, changes no contracts, and is small enough to land with unit tests
   in one slice.
2. **Ship Option B as a follow-up slice on top of A**, in two steps: first the
   synthetic sibling gates (with the args-trust guard, no drain), then the
   pre-teardown drain if real-world runs show the args refresh losing the race often.
   Measure with the existing `[HITL]` logs (`acp-interactions.ts:170-187`,
   `stream.py:486-494`).

## Independent flag (pulled into this PR on Mahmoud's review)

The frontend pattern of force-settling any unsettled part with a synthetic error
(`UnhandledClientTool.tsx:17-21`) manufactures history that the model later trusts as
a real tool failure. After Option A, only genuinely unknown client tools reach it,
which is its intended job. Still, the settle text lies about agency ("this app can't
handle X" for things that are not client requests). The fix: settle with a neutral
"not handled by this client" output and render it as informational, without any
tool-name special-casing. Mahmoud asked for this in this PR ("let's do that in this
pr already"), so it ships here: the settle is now the structured output
`{status: "not_handled", ...}` and `ToolActivity` renders that shape (and the
runner's `DEFERRED_NOT_EXECUTED:` sentinel on deferred siblings) muted, not red.
Both branches key on structured shape, never a tool name.
