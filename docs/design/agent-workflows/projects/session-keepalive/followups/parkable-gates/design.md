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
parking to the remaining gates worth a relay restructure, and it makes the durable-decision
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
directory and writes the response file. For a tool marked `ask`, the runner records a durable
pending interaction and has no verdict yet, so it writes nothing; the in-sandbox poll spins to
its deadline and throws, the harness turns the throw into a tool error, and the turn ends.

This whole wait runs in the Pi process, inside the sandbox. It is process memory. When the turn
ends and the session is torn down, the poll is gone.

### Why it is not parkable

The runner holds no handle. By the time the turn ends, the Pi side is either still spinning on a
file that will never appear or has already thrown. There is no promise in the runner's memory to
answer later, the way there is for a Claude ACP request. The decision to pause is expressed by
*the absence of a response file*, which is not a handle anyone can hold.

### Options

**Option A: raise or remove `RELAY_TIMEOUT_MS`.** Give the in-sandbox poll a much longer, or
unbounded, deadline so it does not throw while a human deliberates.

- Trade-off: this changes nothing about parkability. The poll is still process memory inside the
  sandbox. Today the session is destroyed at turn end, so a longer poll dies with it just the
  same. Worse, an unbounded poll with no other change would block Pi's `prompt()` forever if the
  answer never comes, which is the run-hang failure the approval model already learned to avoid.
  A bigger number moves no handle into the runner. Rejected.

**Option B: invert the relay so the runner owns the pending decision and the sandbox wait is
held open across a park.** Two things change together. First, the runner stops treating "no
response file" as a timeout to wait out. When `startToolRelay` sees an `ask` request, it records
a **runner-held pending handle** keyed by the tool-call id (the relay's analog of
`pendingPermissionRequests`) and does not write a response. Second, the in-sandbox poll becomes
park-aware: instead of a fixed 60-second deadline, it waits without timing out **while
keep-alive holds the Pi session alive**, and the runner writes the response file into that same
still-living sandbox when the human answers. The blocked `execute` callback reads it and returns
its real result, so Pi continues the original call with its original arguments. No new agent
re-issues anything.

- Trade-off: this is a relay change, not a one-line config change. The poll must gain a
  park-aware, keep-alive-gated wait (unbounded only while the session is parkable, still bounded
  and fail-closed otherwise, so a non-keep-alive run keeps today's safety). The runner must emit
  a `paused` stop for the egress stream while the Pi `prompt()` is genuinely still in flight
  inside the blocked `execute`; the Claude path ends a turn while holding an out-of-band request,
  whereas here the turn ends while an in-band tool call is suspended. That ordering is the novel
  part and the main risk. In return, the Pi relay gate becomes as parkable as the Claude gate,
  on the transport that already exists.

**Option C: give Pi a first-class permission plane, the way Claude has one.** Stop expressing Pi
approvals through the relay files at all. Pi's ACP bridge would raise a real permission request
that the runner holds as a promise, exactly like Claude's ACP gate, and Gate 2 answers it with
no relay involved.

- Trade-off: this is the cleanest end state. It removes the whole "pause expressed as a missing
  file" awkwardness and makes the two harnesses share one gate mechanism. But Pi's bridge reports
  `permissions: false` today (`how-approvals-work.md`, Pi's row); it has no answerable permission
  plane, and adding one is upstream work in Pi, not something the runner can build alone. It is
  the right north star and the wrong thing to depend on now.

### Recommended option

**Option B, with Option C as the stated north star.** Option B reaches the same parkability the
Claude gate has, using the relay files already in place, and it degrades cleanly: with keep-alive
off, or on any run that cannot park, the poll keeps its bounded fail-closed deadline and the gate
stays exactly as correct as today. It is the "relay restructure" this project is willing to do.
Option C is where the design should end up if Pi's bridge ever grows a native permission plane;
until then, B is what ships.

Before/after, one Pi approval, against the invariant:

- Today (tier 3): Pi calls a gated tool. The runner records a durable interaction and writes no
  response. The in-sandbox poll spins for 60 seconds and throws. The turn ends. The human clicks
  Approve. A fresh Pi session cold-replays the transcript, and the model re-issues the call from
  text as a NEW `tool_use`; the runner matches it against the stored decision by name plus
  canonical arguments. If the regenerated arguments drift, the gate re-fires. The LLM call
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
them, a Pi `tool_call` hook (`agenta.ts:181-207`) runs before the builtin and blocks synchronously
on `relayPermissionCheck` (`dispatch.ts:131-213`). That function writes a permission request into
the same relay directory and polls for a permission response, on the same `RELAY_TIMEOUT_MS`
deadline (`dispatch.ts:176`). It is fail-closed by construction: the comment at `dispatch.ts:129`
states it "must fail closed because returning nothing lets Pi execute the builtin." On timeout or
any unparseable answer it returns a deny, so an unanswered gate blocks the builtin rather than
letting it run.

### Why it is not parkable

Same reason as Gate 1, one level in. The wait is a synchronous block inside the Pi process, on
the same in-sandbox file poll. The runner holds nothing. A synchronous in-process block cannot by
itself survive a turn boundary.

### Options and recommendation

The mechanism is the relay, so the options are Gate 1's options. Recommended: **Option B**, the
same inverted, park-aware relay, shared with the custom-tool gate. One extra constraint applies
here. The hook's paused state must not be expressed as a `blockReason` (a deny), because
fail-closed treats a deny as final. Parking has to be a genuine third outcome (suspend and wait),
distinct from allow and deny, held open only while keep-alive holds the session. When keep-alive
cannot park, the hook keeps today's fail-closed timeout, so a builtin never runs unapproved.

Because both Pi gates ride the same relay, they should be built as one change, not two.

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

## How this composes with keep-alive, session resume, and the interactions plane

These gates only become parkable inside keep-alive; a parked handle is worthless if the session
that owns it was torn down. So this work sits on top of keep-alive slices 1 and 2, and it slots
into the tier model above, which extends the two-tier picture in architecture-notes.md with the
middle tier the experiments defined.

- **The parked handle is tier 1, the fast in-memory tier.** A runner-held relay handle (Pi) or a
  held MCP socket (client tool) resumes the original call with no replay, valid for the approval
  TTL. The only byte-exact tier.
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
Pi relay inversion and the client-tool hold-open land on top of, or inside, that work, on its
schedule; building them against the current runner-local pool would produce a conflict, not a
head start. Parkable gates and session resume are two tiers of one invariant, not two features,
and they should be planned as one roadmap.

- **v-next (the relay restructure).** Options B for both Pi gates, built as one change to the
  relay: a runner-held pending handle, a park-aware keep-alive-gated wait replacing the fixed
  60-second deadline, and the response-into-parked-sandbox resume. This is the larger and
  higher-value piece, because Pi has no tier-1 path today at all, and because a relay
  restructure is an accepted cost for this work. Coordinate with the backend warm-session move;
  the pending-handle registry should live wherever the pool lands.
- **v-next (client tools), gated on a measurement.** Option A for the client-tool MCP pause: hold
  the socket open. Ship it only after measuring Claude's MCP client request timeout and confirming
  it covers at least the idle TTL. If it does not, hold for the idle TTL only and keep cold-replay
  for the approval TTL.
- **later (the north star).** Option C for Pi: a first-class Pi permission plane that makes the
  relay files unnecessary, once Pi's bridge can raise an answerable permission request. Out of our
  hands until Pi changes; recorded so the relay restructure is understood as a bridge to it, not a
  final shape.

---

## Risks and open questions

- **Ending a turn while an in-band tool call is suspended (Pi).** The Claude gate ends a turn while
  holding an out-of-band request. Option B ends a turn while Pi's `prompt()` is still inside a
  blocked `execute`. The egress must emit `paused` and stop streaming without Pi emitting an error
  or a spurious result. This is the least-proven part and deserves a spike (drive one Pi session,
  block a tool, park it a minute, answer it, and confirm the original call resumes) before the full
  build, mirroring the slice-2 spike. The experiments narrowed the blast radius of getting it
  wrong: Pi's session file already holds the pending call mid-block, so a park that dies degrades
  to a tier-2 continuation, not to a lost turn. They did not test the park itself; the spike
  still must.
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
