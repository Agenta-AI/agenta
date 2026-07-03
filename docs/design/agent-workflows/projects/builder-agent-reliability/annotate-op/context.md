# Context

Date: 2026-07-01
Area: SDK op catalog (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`), with a small
API-side dependency (a reserved evaluator).

## Why this work exists

We want a running agent to grade its own run. This is use case 3 of
[`builder-agent-reliability`](../README.md): the self-reflecting agent.

After a conversation, the agent should write a short evaluation back onto the trace it just
produced: what went right, what went wrong, what it learned, and a score. The platform's
annotation and evaluation views then read that reflection like any other annotation. The
agent grades itself, and the grade shows up next to human grades on the same trace.

## The use case (case 3)

The prompt: a self-reflecting agent that, after each conversation, reflects on how it did and
records that reflection on its own trace. Each reflection carries a short write-up, a
good-or-bad judgment, and whatever extra structured detail the run wants to attach. The write-up
and judgment are the same fields every time; the extras vary run to run. One run might note
`{"reflection": "answered in one turn", "score": "good", "meta": {"turns": 1}}`; the next might
note `{"reflection": "user rephrased twice", "score": "bad", "meta": {"retries": 2}}`.

For that to work, the agent needs a tool it can call at the end of a turn that says "annotate
my current run's trace with this reflection." The tool must always target the agent's own
trace, never another one, and it must accept the varying extras without the second call failing.

## Background: what already existed, and what did not

The plumbing was already there. The pieces are:

- The annotations REST API (`POST /api/annotations/`) is production-grade. It creates an
  annotation trace that links to the trace it annotates.
- The run's own `trace_id` and `span_id` are captured per run in `RunContextTrace` and are
  bindable through `$ctx.trace.*`. So a tool can target "my own trace" without the model ever
  seeing or choosing a trace id.

The missing piece was the tool itself. There was **no agent-callable annotate op**. The
platform-op catalog (`PLATFORM_OPS`) shipped 19 ops (`find_capabilities`, `query_workflows`,
`commit_revision`, the trigger and subscription ops), and none of them annotate a trace. No
builtin, gateway, or MCP tool did either. A self-reflecting agent had the plumbing under it
but no way to reach it.

The gap was known and documented as a porting recommendation in `build-notes.md` (case 3),
not a hack. This project designs the op that closes it.

## Goals

- Add one catalog op, `annotate_trace`, that lets an agent record a structured reflection on
  its own current run's trace.
- Make the self-target airtight. The agent can only ever annotate its own trace, under one
  known evaluator, and can influence only the reflection content.
- Accept a stable reflection shape (write-up, judgment) with open extras that vary run to run,
  without the second call failing.

## Non-goals

- Annotating another agent's trace, or an arbitrary trace by id. The op is self-only.
- A general annotation API for the model (arbitrary evaluators, arbitrary links). The model
  supplies content only.
- Aggregation or scoring UI. The reflection surfaces through the existing annotation and
  evaluation views with no new UI.
