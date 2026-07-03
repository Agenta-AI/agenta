# Streaming invoke — reliable multi-tool output

> Superseded: the permission/approval model described here was redesigned in [projects/approval-boundary/](../../approval-boundary/) (2026-07). Kept as a dated record.

Design docs only. No code.

A well-formed multi-tool agent run (list Slack channels, read GitHub commits/issues, post to
Slack) comes back from the batch invoke as an EMPTY or mid-sentence reply, even when every tool
executed. The caller cannot tell from the response whether the run reached its terminal action —
it has to read the trace spans to find out. That is the "unreliable output" the builder kit works
around today with a separate `check-tools.sh` span query.

The full turn — every tool call, every tool result, the stop reason — is already produced by the
runner and is fully visible over a **streaming invoke** (`Accept: application/x-ndjson`), confirmed
live. Batch returns only the final assistant text, by design.

## The direction

Use **streaming everywhere** the full turn matters, and leave batch alone.

- **Batch is unchanged.** It returns one final assistant message
  (`services/oss/src/agent/app.py:303-321`). We are not coalescing the full turn into it.
- **The external client streams** to get the whole turn. Already done in the lab kit
  (`test-agent.sh`).
- **The platform's own invoke must stream too.** When Agenta invokes an agent from inside the
  platform — an agent invoking another app/agent as a tool, an evaluation running a
  workflow-under-test, a trigger firing a workflow — it sends `Accept: application/json` today and
  gets the same partial output. The proposed change is a draining `invoke_workflow_streaming` variant
  on `WorkflowsService`, applied first to the workflow/agent-as-tool path
  (`api/oss/src/apis/fastapi/tools/router.py:1306`).
- **The approval boundary is a bug.** An auto-approved run stops at the tool gate because the runner
  parks on any session id before consulting the `auto` policy
  (`services/agent/src/responder.ts:257`). Full detail and fix in `approval-boundary.md`.

## Files

- `context.md` — the symptom, the live reproduction (batch vs streaming, same input), the direction
  (stream everywhere, batch untouched), and the approval-boundary bug in brief. Goals and non-goals.
- `research.md` — the mechanism with `file:line` citations: the batch handler, the streaming emitter,
  the `AgentResult` shape, the Accept→`flags.stream` negotiation, the event vocabulary, **where the
  platform invokes agents (batch vs streaming)**, and the corrected approval-boundary mechanism.
- `plan.md` — the direction and the platform-side change: the draining `invoke_workflow_streaming`
  variant, which platform sites to convert (workflow-as-tool first, evaluations second, triggers/
  sessions already detached), the decisions, and the test matrix.
- `approval-boundary.md` — the detailed page on the auto-approve-stops-at-the-gate bug: exact
  behavior, root cause, when it was introduced (commit `b109cc51ef`), how the frontend hides it via
  resume, the verdict (bug), and the recommended fix.
- `status.md` — current state, what is decided, open questions, and what feedback this needs.

## Status

Design under review. Live-verified on `bighetzner.agenta.dev`. Sibling of `invoke-validation/`
(that one is malformed-request → silent 500; this one is well-formed-run → partial output). The lab
kit half (use streaming in `test-agent.sh`, make `check-tools.sh` optional) already shipped in
`agent-creation-lab/kit/`; this workspace covers the platform-side change and the approval-boundary
bug. See `status.md`.
</content>
