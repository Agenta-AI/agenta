# Thread 02 — request_connection client tools + Claude support

## Context

`request_connection` lets an agent ask the user to connect an account (Slack, GitHub).
The browser fulfills it. It works on the Pi harness only today. You want it on Claude
too, with no silent breakage.

## Explanations

- Flow: advertise the client tool to the model, the model calls it, the runner parks
  it, the browser runs the connect flow, the agent resumes.
- Pi-only gap: Claude gets its tools over an internal MCP server, and client tools are
  filtered out of that channel (`mcp-bridge.ts:93`, `tool-mcp-http.ts:96-97`). The
  fallback ACP "park" branch (`permissions.ts:64-97`) is dead code (nothing feeds it,
  no test).
- Other issues found: the park logic is duplicated (one copy dead); schema-validation
  helpers are copy-pasted across three files; `render: connect` is off the typed
  contract.
- Full cleanup plan written: `projects/agent-client-tool-cleanup/plan.md`
  (with `research.md` evidence and `README.md` index).

### The proposed Claude mechanism (from the plan)

Advertise client tools over MCP (stop filtering them out), then park them inside the
MCP `tools/call` handler using ONE shared `buildClientToolRelay` seam (the same one Pi
uses): emit the interaction, tear the session down via Claude's already-proven park
path, resume next turn through the existing approval-decision feedback. A fail-loud gate
ships first, so any path that cannot deliver-and-park a client tool errors loudly
instead of silently delivering zero tools.

(Codex xhigh review of this plan is running for soundness, organization, and code
quality. Its relevant comments will be folded into the plan. Per D2 below the interim
fail-loud gate is being dropped, so we build Claude delivery directly.)

Phases: (1) fail-loud gate + typed `connect`; (2) consolidate helpers + rename;
(3) one park seam + delete the dead branch; (4) Claude delivery; (5) Daytona poll
backoff.

## History

- #4936 made client tools work on Pi.
- Review found the Claude gap, the dead branch, and the duplication.
- You directed: Claude must work, no silent breakage; fold all of it into one plan.
- Plan drafted (plan-feature). Decisions baked: typed `connect`, required stays on,
  rename `publicToolSpecs`.

## Status (cleanup PR #4985)

Implemented, 400 tests green, PR #4985 open. NOT merge-ready. Gated by:
- **Base drift / rename (decision pending):** big-agents is ~57 commits ahead and renamed
  `services/agent/` -> `services/runner/` (#4968); the lane is on the old paths and does not
  rebase cleanly. Decide: migrate the lane onto `services/runner/` (recommended, mostly
  mechanical) or rebuild fresh.
- **Codex review (3 fixes):** (P1) abort not wired end-to-end (MCP `tools/call` lacks the abort
  signal; teardown does not abort `mcpAbort`); (P2) batch `Promise.all` can run a sibling
  side-effecting tool when one parks; (P2) a client output of `{approved:true}` misroutes to the
  permission store. Codex OK'd the Daytona guard, the schema fix, and the Pi path.
- **Live QA not run** (Pi + Claude `request_connection` round-trips).
All three get handled in one fix pass during the migration, then QA, then ready -> your gate-2.

## Open decision threads

**D1. Approve the plan and phasing?**
Plan: `projects/agent-client-tool-cleanup/plan.md`. My recommendation: approve phases
1-3 to start (safety + cleanup + one seam), then review phase 4 (Claude delivery) before
building it, since it has live-verification risks (whether `destroySession` aborts an
in-flight MCP call cleanly; how the connect widget correlates without an ACP tool-call
id). [[no I have reviewed already everything. please address and let's do it in one thing]]

Your decision: **plan looks sound (your words).** Codex xhigh reviewed it. Verdict: MCP
`tools/call` is the right fulfillment point, but do NOT implement as written. The crux: on
park the handler must return NO tool result (else Claude settles/clobbers the widget), and
`destroySession` does not reliably abort an in-flight MCP call. I sent the cleanup agent
Codex's six findings (park redesign, ACP-id correlation, separate resume store, include
`tool-mcp-http.ts` in the schema cleanup, move client code to `client-tools.ts`, phase
reorder) to revise `plan.md`. See new D3.

**UPDATE: `plan.md` is now revised** and addresses all six: park emits NO JSON-RPC result
and the handler aborts its own in-flight request (plus an engine `AbortSignal` as backup);
an ACP-tool-call-id correlation index (name+args becomes the cold-replay fallback only); a
separate client-output store with a FIFO list per key (no approval/output collision); the
`tool-mcp-http.ts` empty-schema bug fixed via the shared accessor + required-arg validation;
client code in a new `client-tools.ts`; phases reordered with the dead-branch delete last.
Ready for your approval. One live-verification unknown remains: whether Claude re-calls the
tool on cold-replay resume or sees the result already in replayed history (the separate
store is correct either way).

**D2. Interim behavior if full Claude delivery is hard.**
The plan ships a fail-loud gate first, so Claude + client-tool runs error clearly until
delivery lands (no silent zero-tools). OK as the interim?

Your decision: **No interim gate. Build Claude client-tool delivery directly.** The plan
will be revised so phase 1 drops the fail-loud gate and the real Claude delivery is the
work, not a stopgap.

**D3. Claude + Daytona tool delivery (researched — bigger than client tools).**

Your questions: why can't the remote sandbox reach the runner loopback, why does MCP work for
other things, what are the options.

Why the loopback fails: the runner gives Claude its tools by standing up a tiny MCP server on
the RUNNER's loopback (`127.0.0.1`) and handing Claude that URL. Loopback means "this same
machine." Locally Claude and the runner share a host, so it works. On Daytona Claude runs
inside a REMOTE sandbox, where `127.0.0.1` is the sandbox, not the runner, so the URL is dead.
The code already skips the loopback MCP on Daytona (`mcp.ts:230`).

Why tools work on Daytona "for other things": only for PI. Pi runs an in-sandbox extension that
writes tool requests to files; the runner polls and answers them (the file relay). Claude has
NO in-sandbox writer. So the scope is bigger than client tools: **on Daytona, Claude gets ZERO
custom tools of any kind** (gateway, callback, and client). And today it fails SILENTLY (the
capability gate passes; the log even claims "delivered via the file relay," which is false for
Claude). Claude+Daytona was never validated green.

Options:
- (c) Honest fail-loud error NOW — a few lines; a Claude/MCP harness on Daytona with any custom
  tools errors clearly instead of dropping them silently. Trivial, no risk.
- (a) The real fix when needed — run the MCP server INSIDE the sandbox (on the sandbox's own
  loopback, reachable by Claude) feeding the existing file relay. The relay is already
  harness-agnostic; only the in-sandbox writer is Pi-specific. Medium effort, low risk, no new
  network surface. A separate future project.
- (b) Expose the runner MCP over the network — high risk; avoid.

My recommendation: ship (c) now (folded into the cleanup PR, broadened to ALL custom tools), and
build (a) as its own project when needed. I already asked the cleanup agent to add the (c) gate.

Your decision: **(c) now, (a) as serious follow-up.** Ship the cleanup PR WITH the honest
fail-loud error for Claude+Daytona (already in the cleanup agent's scope). Separately: (1) a
Linear issue is drafted for you to add manually ("MCP Claude with Daytona: zero tools, silent"),
and (2) a /plan-feature subagent is doing serious design with MULTIPLE OPTIONS for the real fix,
under `projects/claude-daytona-tools/`.

**PLAN DONE** (`projects/claude-daytona-tools/`): recommended **option A** — an in-sandbox MCP
shim feeding the EXISTING file relay (the MCP analogue of Pi's bundled extension). It is small
because tool execution on Daytona is already solved and harness-agnostic; only an in-sandbox
front-end for Claude is missing, and the internal MCP server already binds loopback (which means
the sandbox's own loopback when run inside it). ~2-3 days, low risk, high reuse. Option B (expose
the runner MCP over the network) rejected as high-risk. Four open questions in design.md
(transport, sequencing, packaging, fixed-port vs file read-back). It becomes a draft PR for your
gate-1 LGTM when you prioritize it (the Linear follow-up; not urgent vs the immediate work).

_(Already decided: `connect` typed; required-field validation stays on; rename.)_
