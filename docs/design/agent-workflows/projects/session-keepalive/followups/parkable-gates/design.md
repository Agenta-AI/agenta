# Parkable gates: how the other three approval gates pause, why they die on a turn boundary, and how to make them survive

Keep-alive slice 2 made one thing true: a Claude approval survives the turn it paused on. The
human clicks Approve minutes later, and the runner answers the exact tool call that was open,
with its exact original arguments. No new agent re-issues anything, so nothing drifts.

That property has a name in this design: a gate is **parkable**. A gate is parkable if, after
the turn ends, the runner still holds a handle it can answer to make the original tool call
proceed. Only the Claude ACP permission gate has that handle today. The Pi custom-tool relay
gate, the Pi builtin gate, and the client-tool MCP pause do not, so each still destroys its
session on pause and resumes through cold replay (a fresh agent reads a flattened transcript,
re-issues the call from text, and hopes its arguments match a stored decision). That is the
path both production approval failures came from.

This document explains, for each of those three gates, how it pauses today (with the real code
mechanism), why it cannot be parked as built, the options for making it parkable, the
trade-offs, and the recommended option. It closes with how the result composes with keep-alive
and the interactions plane, the scope and ordering, and the honest risks.

Everything below is verified against `services/runner/src` as of 2026-07-08.

---

## The parkability property, and where each gate holds its pending state today

The crux is one question: **where does the pending wait live?** If it lives in the runner's own
memory, the runner can answer it after the turn ends, so the gate is parkable. If it lives
inside the sandbox, or the runner destroyed it on pause, there is nothing to answer, so the gate
is not parkable.

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

Before/after, one Pi approval:

- Today: Pi calls a gated tool. The runner records a durable interaction and writes no response.
  The in-sandbox poll spins for 60 seconds and throws. The turn ends. The human clicks Approve.
  A fresh Pi session cold-replays the transcript, re-issues the call from text, and the runner
  matches it against the stored decision by name plus canonical arguments. If the regenerated
  arguments drift, the gate re-fires.
- With Option B (inside the approval TTL): Pi calls a gated tool. The runner records a
  runner-held handle and emits `paused`; keep-alive parks the live Pi session, and the blocked
  `execute` callback keeps waiting. The human clicks Approve. The runner writes the response file
  into the parked sandbox. The same blocked callback reads it and returns. The original call runs
  with its original arguments. Nothing re-issues, so nothing drifts.

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
  TTL (60 seconds) and the approval TTL (5 minutes) has to be measured. This is the load-bearing
  open question for this gate.

**Option B: destroy as today, but re-answer the same call after resume without the harness
re-issuing it.** Keep the socket destroy, but on resume inject the browser output straight into
the harness rather than replaying the transcript and letting Claude re-issue the tool.

- Trade-off: with the socket destroyed and the turn ended, there is no open call to inject into.
  Making the harness hold a client-tool call open across a turn boundary is exactly what the
  destroy exists to prevent. This option is, in practice, today's cold-replay path wearing a
  different name; it does not remove the drift. Rejected as a parkability mechanism.

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

## How this composes with keep-alive and the interactions plane

These gates only become parkable inside keep-alive; a parked handle is worthless if the session
that owns it was torn down. So this work sits on top of keep-alive slices 1 and 2, and it slots
into the same two-tier model architecture-notes.md describes for the Claude gate.

- **The parked handle is the fast, in-memory tier.** A runner-held relay handle (Pi) or a held
  MCP socket (client tool) resumes the original call with no replay, valid for the approval TTL.
- **The durable interaction row is the slow tier.** The runner already writes a
  `session_interactions` row on pause and resolves it on the decision (for committed revisions).
  When the answer comes after the TTL, from another surface, the live session is gone; the answer
  settles the row and a resume replays cold. That is the same settle-by-stored-decision mechanism
  the cold path already uses.
- **Whoever answers first wins.** A quick click resumes the live call through the parked handle; a
  late answer settles the durable row and replays cold. This is identical to the Claude story in
  architecture-notes.md "Relation to the interactions plane," now extended to the Pi and
  client-tool gates. This work does not build the cross-plane resolver; it makes the fast lane
  real for three more gates and leaves the row untouched.

The fall-back rule is the same one keep-alive already lives by: every one of these gates, when it
cannot park (keep-alive off, TTL expired, client timeout too short, session gone), degrades to
exactly today's cold path. Nothing here can fail a turn; the worst case is a cold restart.

---

## Scope and ordering

This is an incremental follow-up **after** keep-alive slices 1 and 2 have run in real use. It is
not part of shipping keep-alive.

- **v-next (the relay restructure).** Options B for both Pi gates, built as one change to the
  relay: a runner-held pending handle, a park-aware keep-alive-gated wait replacing the fixed
  60-second deadline, and the response-into-parked-sandbox resume. This is the larger and
  higher-value piece, because Pi has no human-in-the-loop today at all beyond the cold path, and
  because a relay restructure is an accepted cost for this work.
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
  build, mirroring the slice-2 spike.
- **Claude's MCP client timeout (client tools).** Whether Option A survives the idle TTL and the
  approval TTL depends entirely on a timeout the runner does not own. Measure it before committing
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
- **Credential epoch.** A parked Pi or client-tool handle inherits the same stale-credential risk
  the Claude park has (architecture-notes.md Decision 7). The resumed call runs with the original
  turn's baked credentials, so the same epoch check (expiry plus a process-local value hash) must
  cover these handles too; a park that outlives its credentials evicts to cold.
