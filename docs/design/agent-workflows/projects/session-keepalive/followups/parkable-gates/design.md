# Parkable gates: one invariant, four gates, and why warm parking is the only exact tier

Keep-alive slice 2 made one thing true: a Claude approval survives the turn it paused on. The
human clicks Approve minutes later, and the runner answers the exact tool call that was open,
with its exact original arguments. No new agent re-issues anything, so nothing drifts.

This document extends that property to the three gates that still lack it: the Pi custom-tool
relay gate, the Pi builtin gate, and the client-tool MCP pause. It is judged by one invariant,
stated first, because the invariant (not connection plumbing) is what decides every choice below.

Everything below is verified against `services/runner/src` as of 2026-07-08, and against the
kill-and-resume experiments of 2026-07-09
([protocol](../../../harness-session-resume/experiments/protocol.md),
[report](../../../harness-session-resume/experiments/report.md)).

---

## The invariant this design is judged by

At the LLM layer, an approval is simple. The model API is stateless. Call N ends with the model
returning a `tool_use` block. Call N+1 sends the same message list plus the real `tool_result`
for that block. The invariant this design wants:

> Whether the human answers in ten seconds or after twelve hours, the sequence of LLM API calls
> is identical. Call N ends with `tool_use`. Call N+1 appends the real `tool_result` for that
> same id. Nothing is regenerated in between.

The LLM never waits, so the invariant is achievable in principle: whoever holds the exact
message list and the pending call's identity can answer it at any later time. What breaks the
invariant today is harness plumbing. When a gate pauses a turn, the runner destroys the session
and later replays a flattened text transcript into a fresh agent. That fresh agent makes a new
LLM call, and the model generates a *new* `tool_use` with a new id and possibly different
arguments. Both production approval failures came from exactly that drift.

"Parking" is the mechanism that preserves the invariant: keep the harness process alive (it
holds the real message list in memory) and keep an answerable handle to the blocked call. The
question this document answers per gate is whether such a handle can exist.

## What each tier can actually guarantee (measured, not assumed)

Could a cold restart meet the invariant instead, by resuming the harness's own session file?
The kill-and-resume experiments settled this. Both harnesses were examined mid-gate: blocked on
a permission, pending `tool_use` issued, no result yet. Claude Code was killed and resumed live
on both its paths (CLI `--resume`, and ACP `session/load`, the path the runner ships on, with
the resume id in `_meta.claudeCode.options.resume`); Pi was verified from source. Two findings:

- **The pending `tool_use` survives a hard kill on disk, on both harnesses.** Both flush the
  session file per message, so the assistant message carrying the pending call is durable before
  the gate resolves. Claude's JSONL held it mid-block and was byte-identical after `kill -9`.
  Pi persists on `message_end`, which fires before its permission gate runs.
- **Neither harness will ever answer that surviving call.** On load, the parked call is
  force-settled: Claude ACP records a synthetic error `tool_result` and marks the call failed;
  Claude CLI abandons it as a no-op; Pi injects a synthetic "No result provided" error result at
  the LLM boundary. In every case the model then re-issues a NEW `tool_use` (new id, regenerated
  arguments) to do the work. A logging proxy on the wire confirmed the call sequences differ.

So the tiers rank like this, and only the first is exact:

| Tier | Mechanism | What it guarantees | Bound |
|---|---|---|---|
| 1. Warm park | The harness process stays alive; the runner holds an answerable handle | The invariant, byte-exact: the original call runs with its original arguments | The approval TTL (default 5 minutes) |
| 2. Harness session resume | `session/load` rehydrates the harness's own session file after the process died | Faithful continuation: full structured history, but the parked call is settled as errored and the model re-issues a new one. Small drift risk, bounded because the original request text is still in context | Whenever the file survives |
| 3. Cold replay + durable decision | Flattened text into a fresh agent; the stored decision is matched by tool name plus canonical arguments | Correct outcome when the re-issued arguments match; the gate re-fires when they drift | Always available |

This ranking is the reason this design exists. Warm parking is not a latency optimization; it
is the only tier that meets the invariant. Session resume (which makes tier 2 real) does not
replace it and cannot, by harness policy rather than by lost state. That makes extending
parking to the remaining gates worth real gate changes, and it makes the durable-decision
cold path the permanent answer for anything past the warm TTL, such as an overnight approval.

---

## The parkability property, and where each gate holds its pending state today

A gate is **parkable** if, after the turn ends, the runner still holds a handle it can answer
to make the original tool call proceed. The crux is one question: **where does the pending wait
live?** If it lives in the runner's own memory, the runner can answer it after the turn ends.
If it lives inside the sandbox, or the runner destroyed it on pause, there is nothing to
answer.

| Gate | Harness | Where the pending wait lives today | Parkable? |
|---|---|---|---|
| ACP permission gate | Claude | A pending request in the runner's `pendingPermissionRequests` map, plus a suspended `prompt()` whose HTTP connection is held open by a disabled undici timeout (`acp-fetch.ts`, `headersTimeout: 0`). | Yes (slice 2). |
| Custom-tool relay gate | Pi | A file poll **inside the sandbox**. `relayToolCall` busy-polls for a response file until a deadline (`dispatch.ts:88-110`). The runner holds nothing. | No. |
| Builtin gate | Pi | The same file poll, one level in: a Pi `tool_call` hook blocks on `relayPermissionCheck` (`agenta.ts:181-207`, `dispatch.ts:176-213`). | No. |
| Client-tool MCP pause | Claude (client tools) | Nowhere. The runner **destroys** the in-flight HTTP request (`tool-mcp-http.ts:284-287`, `res.destroy()` with no body). | No. |

The Claude ACP gate is parkable because its wait is a runner-held promise and the harness
process is kept alive by keep-alive. The other three lack exactly that. The rest of this
document is about giving it to them.

The shared fact worth stating once: raising a timeout never makes a gate parkable. A longer
bounded wait is still a bounded wait that dies when the turn ends. Parkability is a question of
*who holds the handle*, not *how long the wait is*.

---

## Gate 1: the Pi custom-tool relay gate

### How it pauses today

Pi cannot reach Agenta from inside the sandbox, so a Pi tool call is relayed through files. When
Pi calls a custom tool, its `execute` callback runs `runResolvedTool`, which calls
`relayToolCall` (`dispatch.ts:66-111`). That function writes `<id>.req.json` into the relay
directory and then busy-polls for `<id>.res.json`:

```
deadline = now + (spec.timeoutMs + 10s, or RELAY_TIMEOUT_MS)   // dispatch.ts:88-90
while (now < deadline) {
  if (response file exists) return its text
  sleep(RELAY_POLL_MS)                                          // 300 ms
}
throw new Error("tool relay timed out for <name>")             // dispatch.ts:110
```

`RELAY_TIMEOUT_MS` defaults to 60000 and is set by `AGENTA_AGENT_TOOLS_RELAY_TIMEOUT`
(`relay.ts:61-63`). On the runner side, `startToolRelay` (`relay.ts:449`) watches the same
directory and writes the response file.

For a tool marked `ask`, the sequence is faster and harsher than a timeout. The relay watcher
sees the request, emits the approval event, records the durable pending interaction, writes no
response, and fires the pause controller (`relay.ts:255-263`, `sandbox_agent.ts:1272-1293`).
The pause controller ends the turn `paused` and immediately destroys the Pi session
(`sandbox_agent.ts:1135-1157`): its keep-alive exemption keeps a session alive only when
`env.parkedApproval` was recorded, and the only code that records it is the Claude ACP
permission hook (`sandbox_agent.ts:1321-1338`). So the in-sandbox poll never reaches its
60-second deadline on an ask; it dies of teardown, moments after the ask is recorded. The
deadline matters only as a backstop on calls where nothing pauses (a slow callback response).

### Why keep-alive does not park it today

The natural question: within the warm window, why not simply hold the request open until the
response arrives, the same behavior the Claude ACP gate has, and go cold only when the session
does? That is exactly the right end state, and nothing structural prevents it. The runner
already holds everything a handle needs (the sandbox, the relay directory, the tool-call id,
the recorded interaction), and the in-sandbox poll would keep waiting as long as the sandbox
lives. The reason it does not work today is not the timeout; it is that three specific pieces
of code are Claude-shaped:

1. **The park decision destroys Pi first.** The pause path keeps a session alive only when the
   Claude hook recorded `parkedApproval`; a Pi ask never records one, so the session (and the
   poll inside it) is destroyed the moment the pause fires (`sandbox_agent.ts:1145-1157`).
   Raising `RELAY_TIMEOUT_MS` to match the warm TTL changes nothing here: the poll does not
   die of its deadline, it dies of this teardown.
2. **The resume has no write-the-file action.** When the approval arrives, the dispatch's only
   live-resume verb is `session.respondPermission` (`server.ts`), which answers a
   harness-raised ACP request. No code path maps "human approved tool-call X" to "execute the
   callback and write X's response file into the parked sandbox."
3. **The poll deadline is shorter than the park window.** Once 1 and 2 exist, the in-sandbox
   deadline must cover the approval TTL on keep-alive runs (and stay bounded, fail-closed,
   everywhere else).

These are deltas to the existing mechanism, not a redesign. Option B below is precisely these
three deltas and nothing more.

### Options

**Option A: raise or remove `RELAY_TIMEOUT_MS` and change nothing else.** Give the in-sandbox
poll a deadline that matches the warm window, so it does not give up while a human deliberates.

- Trade-off: the timeout is not what kills the wait; the destroy-on-pause is (piece 1 above).
  A poll with a week-long deadline still dies moments after the ask, when the pause controller
  destroys the session. And on any run that cannot park (keep-alive off, pool full), a long or
  unbounded deadline would block Pi's `prompt()` with no one ever coming to answer, which is
  the run-hang failure the approval model already learned to avoid. A bigger number, alone,
  fixes nothing and adds a hang risk. Rejected as a standalone change; the deadline change is
  real but it is piece 3 of Option B, valid only alongside pieces 1 and 2.

**Option B: park the relay wait: keep the session alive, write the response file on approval.**
This is the hold-until-answered behavior stated plainly, built as the three deltas from "why
keep-alive does not park it today":

1. The pause path records a Pi park (the analog of `parkedApproval`: gate type, tool-call id,
   the relay directory) instead of destroying the session, under the same keep-alive park-mode
   conditions the Claude gate uses.
2. The approval-resume dispatch, when the parked gate is a Pi relay gate, executes the approved
   callback and **writes the response file into the still-living sandbox** (a deny writes a
   deny), instead of calling `respondPermission`. The blocked `execute` callback reads it and
   returns its real result, so Pi continues the original call with its original arguments. No
   new agent re-issues anything.
3. The in-sandbox deadline covers the park window on keep-alive runs (approval TTL plus
   margin), and keeps today's bounded fail-closed behavior everywhere else.

To be precise about what "turn" means here, because it is where the mechanism is easy to
misread: no new prompt is ever sent to Pi on this path. Pi's original `prompt()` stays in
flight the whole time, suspended inside the blocked `execute`. The "new turn" is only the
transport of the human's decision: the frontend delivers the approval as a new `/run` request,
and that request's stream adopts the resumed events, exactly as the Claude resume already does.
Pi itself sees one uninterrupted turn. Only when the park is gone (TTL expired, session died)
does the decision arrive at a genuinely new agent turn, the cold path below.

- Trade-off: the changes live in three places (pause path, resume dispatch, poll deadline)
  rather than one, and the egress must emit a `paused` stop while Pi's `prompt()` is genuinely
  still in flight inside a blocked tool call; the Claude path ends a turn while holding an
  out-of-band request, whereas here the turn ends while an in-band call is suspended. That
  ordering is the novel part and the main risk. In return, everything stays in our code, on the
  transport that already exists, with no new dependency.

**Option C: route Pi approvals over the ACP permission plane the bridge already has.** Stop
expressing Pi approvals through the relay files at all; raise them as real ACP permission
requests the runner holds as promises, exactly like Claude's gate. The relay files stay for
tool execution only.

An earlier draft dismissed this as upstream work inside Pi. That was wrong on both counts, and
the corrected picture makes C much closer than "north star":

- **Pi already has the hooks.** Every Pi extension event handler receives a `ctx.ui` with
  `confirm(title, message): Promise<boolean>` plus `select`/`input`/`notify`
  (`pi-coding-agent/dist/core/extensions/types.d.ts:208-214, 804`), and dialog UI is available
  in RPC mode, the mode the bridge runs Pi in. Our in-sandbox extension's `tool_call` hook and
  a custom tool's `execute` can await a dialog the same way they await the file poll today.
- **The bridge already translates that dialog into a real ACP permission request.** `pi-acp`
  maps an extension `confirm` event to `session/request_permission` with yes/no options and
  feeds the answer back to the blocked `ctx.ui.confirm`
  (`pi-acp/dist/index.js:1106-1128`, `handleExtensionConfirm` -> `conn.requestPermission`).
  The `permissions: false` note in how-approvals-work.md is about Pi's own tool executions
  never consulting the client; the extension-UI dialog path does consult it, today.
- **So the missing piece is neither Pi nor the protocol.** If our extension asked
  `ctx.ui.confirm` at the gate instead of polling the relay, the runner would receive the same
  parkable, answerable ACP request it gets from Claude, and slice 2's park machinery (hold the
  request, park the session, `respondPermission` on resume) would apply with a new gate type
  and almost no new mechanism.

What is actually missing, verified against the bundled packages:

- **Payload fidelity.** `pi-acp` synthesizes the ACP tool call from the dialog: id
  `pi-ui-<n>`, `rawInput` limited to title/message/options (`index.js:565, 1130-1144`). The
  real tool-call id and arguments do not ride the request natively, and the approval card and
  decision map key on them. Either encode them in the confirm message and parse runner-side,
  or make a small `pi-acp` change forwarding structured metadata.
- **Ownership.** Pi (`@earendil-works/pi-coding-agent`) is Mario Zechner's; `pi-acp` is a
  separate MIT adapter by Sergii Kozak (`svkozak/pi-acp`, v0.0.29 bundled). Neither is ours.
  A small upstream PR is the clean route, and this repo already `pnpm patch`es
  `sandbox-agent`, so a patch is the normal escape hatch, not a blocker.
- **An unproven hop.** Nobody has driven `ctx.ui.confirm` through the sandbox-agent daemon to
  the runner's permission listener. The Daytona trust prompt rides the same dialog channel, so
  the path exists, but the gate use needs a spike.

- Trade-off: C reuses the proven Claude park machinery unchanged (one gate mechanism for both
  harnesses, no relay-timeout surgery, no write-file resume verb) and removes the "pause
  expressed as a missing file" awkwardness. Against that, it puts a correctness-critical path
  through a third-party bridge and needs the payload-fidelity gap closed by encoding or by an
  upstream change. It shares Option B's novel ordering (the turn still ends while Pi's
  `prompt()` hangs inside a blocked hook), so that risk is common to both.

### Recommended option

**Spike Option C's wire hop first; ship C if the payload survives, otherwise B.** The two
options reach the same parkability and share the same cold fall-back and the same novel
ordering risk. They differ in where the pending handle lives: C reuses the exact ACP request
the Claude park already holds (smallest delta from slice 2, one gate mechanism for both
harnesses, but a third-party bridge in the path and a payload gap to close); B keeps everything
in our own code on the existing relay files (no new dependency, but three code deltas and a new
resume verb). The C spike is small: one Pi session under the bridge, a `tool_call` hook that
awaits `ctx.ui.confirm`, and a check of what the runner's permission listener receives. If the
tool name and arguments survive that hop (natively, by encoding, or by a small accepted
upstream change), C is the better build; if not, B ships and C stays the end state. Either way
the gate degrades cleanly: with keep-alive off, or on any run that cannot park, the bounded
fail-closed behavior of today remains.

Before/after, one Pi approval, against the invariant (the warm mechanics shown are Option B's;
under C the file write is replaced by `respondPermission` resolving the held dialog):

- Today (tier 3): Pi calls a gated tool. The runner records a durable interaction, writes no
  response, ends the turn `paused`, and destroys the session (the poll dies with it). The human
  clicks Approve. A fresh Pi session cold-replays the transcript, and the model re-issues the
  call from text as a NEW `tool_use`; the runner matches it against the stored decision by name
  plus canonical arguments. If the regenerated arguments drift, the gate re-fires. The LLM call
  sequence differs from the warm one.
- With Option B (tier 1, inside the approval TTL): Pi calls a gated tool. The runner records a
  runner-held handle and emits `paused`; keep-alive parks the live Pi session, and the blocked
  `execute` callback keeps waiting. The human clicks Approve. The runner writes the response file
  into the parked sandbox. The same blocked callback reads it and returns. The original call runs
  with its original arguments, and call N+1 to the LLM carries the real `tool_result` for the
  original id. The invariant holds.

## Gate 2: the Pi builtin gate

### How it pauses today

Pi's builtins (bash, read, write) are not relayed for execution; they run inside Pi. To gate
them, a Pi `tool_call` hook (`agenta.ts:181-207`) runs before the builtin and blocks on
`relayPermissionCheck` (`dispatch.ts:131-213`). That function writes a permission request into
the same relay directory and polls for a permission response, on the same `RELAY_TIMEOUT_MS`
deadline (`dispatch.ts:176`). It is fail-closed by construction: the comment at `dispatch.ts:129`
states it "must fail closed because returning nothing lets Pi execute the builtin." On timeout or
any unparseable answer it returns a deny, so an unanswered gate blocks the builtin rather than
letting it run.

On an ask, the runner side does not stay silent the way it does for Gate 1. The watcher answers
the permission request immediately with `verdict: "pendingApproval"` (`relay.ts:433-446`) and
fires the same pause; the hook has no third outcome to express that with, so it maps anything
but an allow to a `blockReason`, a deny (`agenta.ts:199-200`). The pause then destroys the
session the same way as Gate 1. So today an ask on a builtin is answered instantly, as a
blocked call, and the turn ends `paused` with the session gone.

### Why keep-alive does not park it today

Gate 1's three Claude-shaped pieces, one level in, plus a vocabulary gap of its own: the hook's
reply protocol has only allow and deny, so even a parked session would have no way to tell the
hook "suspend and wait." The wait itself is as holdable as Gate 1's: it is the same file poll,
alive as long as the session is.

### Options and recommendation

The mechanism is the relay, so the options are Gate 1's options, and the same recommendation
applies: spike C's hop; C if the payload survives, else B. One extra constraint applies here
under B. The paused state must become a genuine third outcome (suspend and keep polling),
distinct from allow and deny, held open only while keep-alive holds the session; the watcher
must stop answering an ask instantly with `pendingApproval`, because fail-closed makes the hook
treat that as final. When keep-alive cannot park, the hook keeps today's fail-closed timeout,
so a builtin never runs unapproved. Under C the constraint disappears: the hook awaits
`ctx.ui.confirm` and the answer is the answer.

The same turn-versus-prompt reading from Gate 1 applies: on the warm path nothing new is ever
prompted into Pi. The approval arrives as a new `/run` request, the runner writes the
permission response (B) or resolves the held dialog (C), the blocked hook returns, and the
builtin runs inside the original still-open `prompt()`. A genuinely new agent turn happens only
on the cold path.

Because both Pi gates ride the same mechanism, they should be built as one change, not two.

One fact the experiments added: Pi flushes the assistant message carrying the pending tool call
to disk on `message_end`, strictly before this hook runs. So at the moment a Pi gate parks, the
pending call is already durable in Pi's own session file. If a parked Pi session later dies
(TTL expiry, crash, eviction), the disk still holds everything tier 2 needs; the degradation
path is a faithful session-resume continuation, not a total loss.

## Gate 3: the client-tool MCP pause

### How it pauses today

Claude's client tools (for example `request_connection`) are served by an internal loopback MCP
server the runner starts per session (`tool-mcp-http.ts:271`, `startInternalToolMcpServer`). Claude
reaches it as a `type: "http"` MCP server. When a client tool is called, the handler returns the
`MCP_PAUSED` sentinel instead of a JSON-RPC result, and the request listener calls `abortPaused`
(`tool-mcp-http.ts:284-287`, `res.destroy()` with no body), from `:348-352` for a single call and
`:325-327` for a batch.

The destroy is deliberate. The comment at `tool-mcp-http.ts:54-62` explains it: "a normal MCP
result would let the harness (Claude) settle the call and clobber the pending connect widget
before the paused turn is observed." So the pause is expressed *by destroying the transport*. Any
returned result, even an empty one, would tell Claude the tool produced output, and Claude would
settle the call and move on, overwriting the "waiting to connect" widget the frontend just showed.
Destroying the socket leaves the call unsettled, and the runner ends the turn `paused`.

There is also a teardown backstop: an engine abort signal destroys any in-flight request socket
(`tool-mcp-http.ts:386-394`). The comment there is honest about its limit: it "suppresses the
response but does not cancel execution." A `runResolvedTool` already dispatched keeps running
server-side; threading the signal into dispatch is a known follow-up.

### Why it is not parkable

The runner destroyed the request. There is no held socket, no promise, nothing to answer. On
resume, the browser output comes back the same way an approval does: a fresh turn cold-replays,
Claude re-issues the client tool, and the fulfilled output is folded in from the transcript. As
with every cold-replay path, the re-issued call can drift from the original.

### Options

**Option A: hold the MCP socket open instead of destroying it.** Do not write a body and do not
destroy. Leave the request hanging, so Claude's MCP client keeps waiting and the call stays
unsettled. When the browser fulfills the client tool after resume, the runner writes the real
JSON-RPC result into that same held socket, and Claude continues.

- This directly answers the widget-clobber constraint: an unsettled call cannot clobber the
  widget, and no body is written until the real output exists, so there is never a premature
  settlement. It is the exact analog of the Claude ACP held request.
- The honest catch is an asymmetry with the ACP gate. For the ACP gate the held connection is the
  runner's *own* undici fetch to the daemon, so the runner disabled its *own* client-side timeout
  (`acp-fetch.ts`). Here the held socket is *Claude's* MCP client connecting into the runner. The
  runner owns the server side, not Claude's client-side request timeout. If Claude's MCP client
  reaps a request that produces no headers for long enough, holding the socket open survives only
  until that timeout, not for an arbitrary park. Whether that timeout is long enough for the idle
  TTL (60 seconds) and the approval TTL (5 minutes) has to be measured; the 2026-07-09
  experiments did not measure it, so it remains the load-bearing open question for this gate.

**Option B: destroy as today, but re-answer the same call after resume without the harness
re-issuing it.** Keep the socket destroy, but on resume inject the browser output straight into
the harness rather than replaying the transcript and letting Claude re-issue the tool.

- Trade-off: with the socket destroyed and the turn ended, there is no open call to inject into.
  Making the harness hold a client-tool call open across a turn boundary is exactly what the
  destroy exists to prevent. The experiments confirmed the general form of this: once a pending
  call has been settled on the harness side, no load path will answer it; the model re-issues.
  This option is, in practice, today's cold-replay path wearing a different name; it does not
  remove the drift. Rejected as a parkability mechanism.

### Recommended option

**Option A, gated on keep-alive and on the measured client timeout, with a clean fall-back to
today's destroy.** Hold the socket open only while keep-alive is on and only for as long as
Claude's MCP client keeps the request open. If a park would outlast that client timeout, fall back
to the current destroy-and-cold-replay, so nothing regresses. The result is that client tools
become parkable for short windows (very likely the idle TTL, possibly the approval TTL) and stay
cold for long ones. This is a weaker guarantee than the Claude ACP gate, and the reason is
structural: the runner does not own the client side of this socket. State that limit plainly
rather than promise a park the transport cannot hold.

---

## The cold path: every gate, when the answer comes after the park is gone

Every gate needs the pair: a warm path (the park above) and a cold path for when the park
cannot help: keep-alive off, pool full, approval TTL expired, sandbox died, human answered
overnight. The cold path is not something this design builds; it exists today for all four
gates and stays the universal fall-back. What makes it work is that the park is only a cache.
The durable record is written at pause time regardless: the `session_interactions` row, plus
the approval card in the conversation whose decision the frontend folds into the next request
(the decision map). A late answer always finds that record.

| Gate | Durable at pause | Cold resume today | After session resume lands | What the user sees |
|---|---|---|---|---|
| Claude ACP permission | interaction row + the decision in the next request | cold replay; the model re-issues the call; the decision map matches it by name plus canonical arguments and answers the fresh gate | `session/load` continues with full structured history; the parked call is settled as errored, the model re-issues, the decision map answers it | click Approve, wait a cold rebuild (tens of seconds), then the tool runs |
| Pi custom-tool relay | same | cold replay; Pi re-issues; the relay's `decide()` consults the decision map and executes on a match | same shape, without the flatten loss | same |
| Pi builtin | same | cold replay; the hook's permission check hits the decision map and allows | same shape | same |
| Client-tool MCP | interaction row + the browser-fulfilled output in the next request | cold replay; Claude re-issues the client tool; the relay answers it with the fulfilled output (`relay.ts:229-237`) | same shape | fulfill in the browser, then a cold rebuild folds the output in |

Two facts bound this table. First, the experiments settled what the "after session resume"
column can ever be: rubric B. The re-issued call carries full structured context but a new id
and regenerated arguments; no load path answers the original call (report, Verdicts). So every
cold resume, today and after session resume, carries the drift risk the decision map exists to
absorb: a re-issued call whose arguments drift re-fires the gate instead of running
unapproved. Fail-closed, never wrong, sometimes one extra click. Second, the warm path must
never consume the durable record. The row and the decision map are written at pause time
whether or not a park exists, so whoever answers first wins and a late answer still lands.
That is already slice 2's behavior for the Claude gate, and the new gates inherit it.

---

## How this composes with keep-alive, session resume, and the interactions plane

These gates only become parkable inside keep-alive; a parked handle is worthless if the session
that owns it was torn down. So this work sits on top of keep-alive slices 1 and 2, and it slots
into the tier model above, which extends the two-tier picture in architecture-notes.md with the
middle tier the experiments defined.

- **The parked handle is tier 1, the fast in-memory tier.** A parked Pi gate (a relay handle
  under Option B, a held ACP permission request under Option C) or a held MCP socket (client
  tool) resumes the original call with no replay, valid for the approval TTL. The only
  byte-exact tier.
- **Harness session resume is tier 2.** When the parked process is gone but the harness session
  file survives, `session/load` continues the conversation with full structured history; the
  parked call is settled and re-issued. This tier belongs to the harness-session-resume project,
  not to this one.
- **The durable interaction row is tier 3, the slow tier.** The runner already writes a
  `session_interactions` row on pause and resolves it on the decision (for committed revisions).
  When the answer comes after the TTL, from another surface, the live session is gone; the answer
  settles the row and a resume replays cold. The stored decision is what makes the re-issued
  call deterministic rather than a fresh model guess.
- **Whoever answers first wins.** A quick click resumes the live call through the parked handle; a
  late answer settles the durable row and replays cold (or, once tier 2 ships, resumes
  faithfully). This work does not build the cross-plane resolver; it makes the fast lane real for
  three more gates and leaves the row untouched.

The fall-back rule is the same one keep-alive already lives by: every one of these gates, when it
cannot park (keep-alive off, TTL expired, client timeout too short, session gone), degrades to
the next tier down. Nothing here can fail a turn; the worst case is a cold restart.

Three slice-2 realities shape how the new parked handles validate and scope, and each new gate
must adopt them rather than reinvent:

- **Resume validation checks the decision, the history, and the mount expiry; nothing else.**
  The approval-resume dispatch (`server.ts`, the `awaiting_approval` branch) deliberately does
  NOT require the resume request's config fingerprint or credential epoch to equal the parked
  session's. The backend re-mints per-request secret material (resolved secret values, the
  per-turn tool-callback bearer), so the incoming epoch never matches a park, and demanding
  equality would evict a good live session on every approval. What bounds a park is the
  approval-decision match for the parked tool-call id, the history fingerprint, and the parked
  mount credentials' own expiry. A parked Pi or client-tool handle must use the same rule.
- **The approval TTL default is 5 minutes** (`DEFAULT_APPROVAL_TTL_MS = 300_000` in
  `session-pool.ts`, overridable via `AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS`). That is the
  ceiling any tier-1 park designs against.
- **The pool's project scope prefers the server-stamped run context.** The pool key takes its
  project id from `runContext.project.id` when the service stamps it, and falls back to the
  mount's owning project id (`session-pool.ts:345-376`). New parked handles inherit the pool key
  as-is.

## Ownership and ordering

This is an incremental follow-up **after** keep-alive slices 1 and 2 have run in real use. It is
not part of shipping keep-alive. And it is not a standalone build: the warm-session machinery is
moving into the backend, and harness session resume (tier 2) is in progress, both owned by JP.
Those two efforts reshape the same pause, park, and resume code this design would touch. So the
Pi gate park and the client-tool hold-open land on top of, or inside, that work, on its
schedule; building them against the current runner-local pool would produce a conflict, not a
head start. Parkable gates and session resume are two tiers of one invariant, not two features,
and they should be planned as one roadmap.

- **v-next (the Pi gate park).** Both Pi gates as one change, with the mechanism decided by the
  small Option C spike: either the extension-UI permission plane (C: the gate awaits
  `ctx.ui.confirm`, the bridge raises a real ACP permission request, and slice 2's park
  machinery holds it) or the parked relay wait (B: park instead of destroy, the write-the-file
  resume verb, a park-length poll deadline). This is the larger and higher-value piece, because
  Pi has no tier-1 path today at all. Coordinate with the backend warm-session move; the park
  record should live wherever the pool lands.
- **v-next (client tools), gated on a measurement.** Option A for the client-tool MCP pause: hold
  the socket open. Ship it only after measuring Claude's MCP client request timeout and confirming
  it covers at least the idle TTL. If it does not, hold for the idle TTL only and keep cold-replay
  for the approval TTL.
- **later (the cleanup).** If C ships on encoded payloads, upstream the structured-metadata
  change to `pi-acp` (or carry it as a pnpm patch) so the encoding disappears. If B ships, C
  stays the recorded end state, now known to be reachable through the existing bridge rather
  than blocked on Pi.

---

## Risks and open questions

- **Ending a turn while an in-band tool call is suspended (Pi).** The Claude gate ends a turn while
  holding an out-of-band request. Options B and C alike end a turn while Pi's `prompt()` is still
  inside a blocked hook or `execute`. The egress must emit `paused` and stop streaming without Pi
  emitting an error or a spurious result. This is the least-proven part and deserves a spike
  (drive one Pi session, block a tool, park it a minute, answer it, and confirm the original call
  resumes) before the full build, mirroring the slice-2 spike. The experiments narrowed the blast
  radius of getting it wrong: Pi's session file already holds the pending call mid-block, so a
  park that dies degrades to a tier-2 continuation, not to a lost turn. They did not test the
  park itself; the spike still must.
- **The Option C hop and its payload.** Nobody has driven `ctx.ui.confirm` from an in-sandbox Pi
  extension through the sandbox-agent daemon to the runner's permission listener, and `pi-acp`
  forwards only the dialog fields, not the gated call's id and arguments. The C spike must show
  the hop works end to end and that the payload survives (by encoding or a small upstream
  change); until it does, Option B is the default build.
- **Claude's MCP client timeout (client tools).** Whether Option A survives the idle TTL and the
  approval TTL depends entirely on a timeout the runner does not own. It is still unmeasured; the
  2026-07-09 experiments covered kill-and-resume behavior, not this. Measure it before committing
  to hold-open past the idle window. If it is short, the client-tool gate parks briefly and stays
  cold for long waits, and that is the ceiling.
- **Fail-closed must stay fail-closed off the park path.** Both Pi gates are fail-closed today for
  a reason: returning nothing lets Pi run the builtin. The park-aware wait must be unbounded *only*
  while keep-alive holds the session; every other path (keep-alive off, no parkable session,
  timeout) must keep the bounded deny-on-timeout behavior, or a gate could silently let a call run.
- **The teardown backstop still does not cancel execution.** The abort signal
  (`tool-mcp-http.ts:386-394`) suppresses a response but leaves a dispatched `runResolvedTool`
  running. Holding sockets open (Option A) does not change that; threading the signal into dispatch
  remains a separate known follow-up, and a parked client tool that is later abandoned must not
  leave a tool running with nowhere to report.
- **Credentials on the resumed call.** A parked Pi or client-tool handle executes with the
  original turn's baked credentials, the same as the Claude park. The bound is the slice-2
  validation rule above: decision match, history fingerprint, and the parked mount credentials'
  expiry. A park that outlives its mount credentials evicts to the next tier down. No config or
  epoch equality is demanded on the resume, because the backend re-mints per-request material.
