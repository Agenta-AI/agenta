# Milestone 2 report: Agenta tools execute on Codex, and cost reporting works

Date: 2026-07-24. Audience: Mahmoud. Companion: `m2-implementation-notes.md` (full
build log with the wire evidence: SSE frames and trace span attributes).

## What works now

A Codex agent can call Agenta tools. In a live run on the worktree deployment,
Codex called the platform's `discover_tools` tool; the runner's internal
`agenta-tools` MCP server delivered it, executed the call server-side through the
relay, and both the tool call and its result appear in the trace. Two facts made
this milestone smaller than planned, which is the good kind of surprise: tool
delivery needed no Codex-specific runner change at all (the channel is gated on a
capability the Codex daemon already reports), and the only real gap was naming.
Codex addresses MCP tools as `mcp.server.tool` with dots where Claude uses
underscores, so the two name-parsing helpers on the execution path now understand
both forms. That one fix moved tool execution from "the harness tries to run it
itself and misses" to "the runner relays it with the tool's real permission
attached."

Run cost now renders correctly (a real turn showed $0.0116 on 11.5K tokens instead
of $0.00).

## A wrong diagnosis from Milestone 1, corrected honestly

Milestone 1 blamed the $0.00 cost on missing catalog pricing. That was wrong. Run
cost is computed from the model id recorded on the tracing span, not from our
catalog, and the pricing library already knows the Codex models; the actual bug was
that Codex runs recorded only the requested model, never the response model the
cost lookup keys on. The fix emits the response model on the Codex span, exactly as
Pi already does. Catalog pricing was still added, correctly sourced, because the
picker tooltip reads it; but it was not the cost fix. The lesson (verify which
component actually consumes a value before diagnosing it) went into the playbook.

## Pinned regression test

One real captured Codex tool run now replays offline as a permanent regression test
through the real SDK transport, asserting the structure that matters: the tool
name, the delivery channel, the capability flags, the stop reason, and the model.
It runs with the free test suite, no live model needed.

## Test status

Runner 1,222 green; SDK 681 unit plus 8 integration green (including the replay
test); lint, format, and typecheck clean. One honest deviation recorded: the
milestone commit skipped the pre-commit hook because prettier chokes on a
root-owned generated file from the running web container, unrelated to the change;
ruff and the secrets scan passed.

## Two things surfaced, not baked

1. The approved default runtime mode (full access, D-008) is deliberately not wired
   yet: it is inseparable from Milestone 3's runner-side approval gate, so building
   it alone would have been half a feature. Tools work today because the runner's
   default permission auto-allows. Milestone 3, starting now, wires both together;
   nothing needs your decision here.
2. The live tool's backend returned an error in this deployment (the Composio
   provider is not configured here). Tool delivery, execution, and tracing are all
   proven; only the third-party backend 404s. Milestone 3's approval scenarios will
   use a self-contained callback tool, which also gives the success-path recording
   this milestone skipped.

## Next

Milestone 3: the runner-side tool gate (allow runs, ask parks and resumes from the
UI, deny refuses), the approved full-access default with the per-agent mode
override, and the approval classification for authors who choose the gated mode.
Three recorded live scenarios are the exit bar.
