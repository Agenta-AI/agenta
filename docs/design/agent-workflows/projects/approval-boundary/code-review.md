# Code review: correctness findings

Scope: the permission/approval code paths (runner responder, ACP gate wiring, relay, SDK
adapters, service handlers). This review looks for bugs beyond the headline one; the
headline bug itself is in [the-bug.md](the-bug.md). Organization findings live in
[code-organization-review.md](code-organization-review.md).

Each finding has a concrete failure scenario. "High" means it can hang a run, lose a
decision, or execute the wrong thing. Line numbers are from the current tree
(`services/runner/`, post-rename).

## High

### H1. A failed permission reply is swallowed; the run hangs and the interaction is falsely resolved

`services/runner/src/engines/sandbox_agent/permissions.ts:106-132` (and the client-tool
branch at 76-89). The whole decide-and-reply chain ends in `.catch(() => {})`. If the
responder throws or `session.respondPermission` rejects (daemon hiccup, connection reset mid
gate), no reply reaches the harness, no park is signaled, and no error surfaces. A headless
run then blocks forever inside `session.prompt()`, which is exactly the hang the park
mechanism was built to prevent (F-040), re-opened on the reply path.

It compounds: `onResolveInteraction(id)` runs at line 126 *before* the reply is sent, so a
reply that then fails has already marked the interaction `resolved`. The gate can no longer
be answered through the interactions plane either.

Fix direction: on a reply failure, park (so the turn ends cleanly) or fail the run loudly;
move `onResolveInteraction` after the reply succeeds.

### H2. Every historical tool result is treated as a stored decision; stale client-tool outputs replay instead of re-prompting

`services/runner/src/responder.ts:353-368`. `parkedCallResultOf` returns `{found: true}`
for *any* `tool_result` block, not only the `{approved: boolean}` approval envelopes. Every
ordinary historical tool output gets stored under its name+args key, and `lookupClientTool`
(`responder.ts:223-231`) returns any such value as a fulfilled client-tool output.

Failure scenario: `request_connection({integration:"slack"})` parks in turn 1; the browser
fulfills it; the output lands in the transcript. In turn 8 the user asks to reconnect and
the model issues the identical call. The relay finds the turn-1 output stored under the same
name+args and returns the stale "connected" result without ever prompting the browser.
Secondary edge: a tool whose replayed output is literally the string `"allow"` or `"deny"`
becomes a permission decision for later identical calls.

The existing test ("ignores ordinary tool results that are not approval envelopes") passes
only because its fixtures lack a correlated `tool_call` block; it does not pin the dangerous
case.

Fix direction: key only `{approved: boolean}` envelopes for permissions; scope client-tool
output replay to results correlated with a parked client-tool interaction (carry the
interaction token), not to any same-name+args result forever.

### H3. Interaction tokens can collide across turns, making a new gate unanswerable on the interactions plane

`services/runner/src/engines/sandbox_agent.ts:661-679` uses the raw ACP permission-request
id as the interaction `token`, and the API's create is idempotent on
(project, session, token): on conflict it returns the existing row
(`api/oss/src/dbs/postgres/sessions/interactions/dao.py:59-65`). Every turn is a cold replay
with a fresh harness session. If the sandbox-agent daemon (the ACP server hosting the
harness) numbers permission requests per session (for example `perm-1`), turn N's token
equals turn 1's. The old row was already cancelled at turn
start (`cancelStaleInteractions`), so the create returns a *cancelled* row and no live row
exists for the new gate; the status transition guard then rejects any respond.

Caveat: the daemon's id scheme is not vendored in this repo, so this is unverified. Verify
it; if ids are per-session counters, namespace the token (for example `turnId:permId`).

### H4. Duplicate tool-call ids bind an old approval to the wrong call

`services/runner/src/responder.ts:312-324`. `callShapeById` is a last-write-wins map keyed
by the replayed `toolCallId`. Claude's `toolu_*` ids are globally unique, so this is latent
today, but the code is harness-generic: a harness that mints per-session counters (`call_0`
recurring across cold-replayed turns) would bind turn 1's `{approved: true}` envelope to the
*latest* `call_0`'s name and args, auto-approving a call the user never saw. Bind shape
lookups within one turn, or fail closed on duplicate ids.

## Medium

### M1. One approval authorizes unlimited identical calls within the resumed turn

`responder.ts:201-206`. The decisions map is fixed for the whole turn, so every re-raised
gate with the same name+args matches the stored `allow`. If the model loops or retries the
identical `send_email(...)` call after the approved one runs, each repeat auto-allows with
no new prompt. This quietly defeats the "reply `once`, never `always`" guard: the harness
re-gates, but the stored decision answers every re-gate. Direction: consume a stored
decision on first match (delete from the map), which is what "once" means.

### M2. The match-on-replay key is fragile: name drift observed live, argument drift latent

A design consequence of the name+args key (`responder.ts:126-135`): the resumed turn
re-generates the tool call, and the stored approval matches only if both halves of the key
reassemble identically. Both halves can miss:

- **Name drift (observed live, via PR #5054's diagnosis).** Claude-over-ACP titles the same
  call differently in different frames: the `tool_call` stream event carries a category
  ("Terminal") while the permission frame carries the specific invocation. The key is built
  from one frame and probed with the other, so it missed even with byte-identical
  arguments. This, compounded with M7 below, produced the infinite approve-loop QA found.
  #5054 patches it by stamping a `resolvedName` from the recorded `tool_call` event onto
  the gate; treat that as evidence of the instability, not as the fix.
- **Argument drift (latent).** The model must reproduce byte-identical arguments on replay.
  Any drift (an added optional field, a reworded command, a regenerated digest text) misses
  the key, parks again, and re-prompts. The mirror case: a stored deny keeps auto-rejecting
  the next identical attempt without a prompt after the user changes their mind.

Both point the same way: keys reassembled from replayed frames are fragile, so the fix
replays the approved call directly instead of matching a re-issued one (plan phase 4).

### M7. Constant stream `messageId` plus a level-triggered resume predicate re-sends forever

Found via PR #5054. The stream egress default `message_id: "msg-1"` is never overridden by
its only caller (`sdks/python/agenta/sdk/decorators/routing.py:284` /
`vercel/stream.py`), so every turn of every conversation streams the same message id and
the Vercel client folds all turns into one assistant message. The resume predicate
(`agentApprovalResume.ts:108-122`) is level-triggered and has no "already resumed" state,
so once an `approval-responded` part exists in that ever-growing last message, the
predicate returns true after every subsequent settle and `useChat` re-sends the
conversation forever. This is the frontend half of the observed infinite loop; it would
loop even if the backend key always matched. Fix (from #5054, worth keeping regardless of
the redesign): a unique message id per turn, and an edge-trigger guard in the predicate (a
`step-start` after the last resolved approval means "already resumed, do not fire again").

### M3. An approval response keyed only by `approvalId` is silently dropped

`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:183-192`. The dedicated
`tool-approval-response` part falls back to `approvalId` as the tool-call id. But
`approvalId` is the ACP permission id, never a tool-call id, so the runner finds no
correlated `tool_call` block, computes no key, and drops the decision; the gate re-parks
every turn while the user keeps answering. Any client that uses the dedicated response part
with its natural key hits this. Also: a non-boolean `approved` (the string `"true"`)
produces no decision. Direction: require the frontend to echo `toolCallId` (the approval
request already carries it) and reject uncorrelatable responses loudly instead of dropping
them.

### M4. Client tools bypass per-tool `permission` entirely

`services/runner/src/tools/relay.ts:208-229` branches on `kind === "client"` *before* the
permission gate at line 233, and the Claude settings renderer also excludes client tools. So
`permission: "deny"` on a client tool is a no-op everywhere: it still parks, prompts the
browser, and executes via stored output. Check `deny` before the client branch.

### M5. A late park can flip a completed turn to `paused`

`sandbox_agent.ts:762-767`. The relay drains in-flight handlers *after* the prompt resolves;
a straggler client-tool request that parks sets `parked = true`, and the `|| parked` clause
then rewrites a genuinely completed turn's stop reason to `paused`. The frontend waits for a
resume of a finished turn. Narrow window, real effect. Latch the stop reason before the
drain, or ignore parks after the prompt resolves.

### M6. The streaming handler leaks the environment when stream setup throws

`services/oss/src/agent/app.py:290-291`. `harness.setup()` and `harness.stream(...)` sit
outside the `try`, so a failure in `stream()` (runner unreachable, resolve failure) skips
`harness.cleanup()`. The batch handler has `stream()` inside its `try` and is safe. Move the
call inside the `try`.

## Low / defensive

- **L1. A permission request without an id emits an approval prompt that can never be
  answered** (`permissions.ts:47, 83, 124`): the event goes out with `approvalId: ""`, then
  the reply is skipped. Skip the emit or treat no-id as park/fail-loud. A test currently
  pins the silent-drop behavior.
- **L2. MCP rule-namespace collision in the Claude settings renderer**
  (`claude_settings.py:141`): a server named `agenta-tools__commit_revision` renders the
  same rule string as an internal per-tool rule, so a server-level allow could shadow an
  internal tool whose effective permission was `ask`. Reserve the internal server name.
  Related: rule strings are unsanitized; a deny rule Claude's matcher cannot parse fails
  open at the harness layer (the relay still backstops executable tools; a whole-server
  deny has no backstop).

Checked and found sound: `canonicalJson` (key-order independent, fails closed on
non-JSON values), the double-park guard, the prompt-vs-park race ordering, and usage
recording on parked turns (both handlers record it).

## Tests that pin behavior the fix will change

- `services/runner/tests/unit/responder.test.ts:227-237`: asserts "a deny basePolicy must
  still PARK", which pins the bug itself.
- `responder.test.ts:184-225, 376-428` and
  `sandbox-agent-orchestration.test.ts:883-989`: expect `park` as the no-match outcome
  under `basePolicy "auto"` with no disposition on the gate; expected outcomes change with
  the fix's default.
- `tool-relay-permission.test.ts:74-77, 123-127`: pin the `ask`-collapses-to-policy
  behavior (`TODO(S5)`).
- `sandbox-agent-permissions.test.ts:128-156`: pins the no-id silent drop (L1).

The plan sequences H1-H4 and M1-M6 alongside the main fix; several of them (H2, M1, M3) sit
in exactly the code the fix rewrites, so fixing them together is cheaper than separately.
