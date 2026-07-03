# Thread 05 — Tool input shows `{}` even when the tool worked

## Context

In the stream UI, both `request_connection` and `commit_revision` show their input as
`{}` even on success. The frontend and SDK are not dropping it. The empty value comes
from upstream, and the cause differs by tool.

## Explanations

- **request_connection:** the model really is calling it with empty arguments. The
  schema the model sees does not force `integration`, and the connect widget tolerates
  empty.
- **commit_revision:** a display artifact. The tool executed with full data (the commit
  worked), but the displayed and traced input is captured once from the first tool-call
  event (`otel.ts`) and never refreshed, so an empty first snapshot stays empty.
- #4936's earlier `{}` fix (disable tool-search) was Claude-only, so the residual
  remains on other paths.

## History

- #4936 tried prompt guidance + schema + a Claude-only tool-search fix.
- The residual `{}` remained.
- Research split it into the two causes above.

## Open decision threads

**D1. request_connection: make `integration` required — approved.**
Verify it is genuinely an integration field first, then require it so an empty call is
rejected and the model retries. Note: this overlaps thread 02's open question of which
schema the model actually sees for `request_connection` (the API catalog vs the SDK
side). Confirm the schema source so the requirement lands in the right place.

Your decision: approved; verify the schema source.

**D2. commit_revision: refresh the recorded input.**
- (a) Refresh `rawInput` on the later tool-call update event in `otel.ts` (robust).
- (b) Ensure the harness emits full `rawInput` on the first event.

My recommendation: (a).

Your question answered (why telemetry is involved): the live chat input does NOT come from
OpenTelemetry. It comes from the STREAM (the SDK projects the runner's `tool_call` event `input`
to the Vercel stream the chat renders). OTel feeds a DIFFERENT surface: the "View full trace"
drawer. The catch: the file named `otel.ts` is misleadingly named. It is actually the runner's
single event-recorder, and in one place it records the tool input from `update.rawInput` for BOTH
the OTel span AND the live stream event. That capture happens only on the FIRST `tool_call`; the
later `tool_call_update` records the output but never refreshes the input. So when
`commit_revision`'s first event has empty `{}` and the args arrive later, the `{}` freezes into
both the trace and the live stream. Two parallel pipelines (stream for the chat, OTel for the
trace drawer), fed by one shared capture point.

Your decision: **(a) — fix in the runner `otel.ts` `handleUpdate`:** refresh the recorded input
(span + live event) when a later `tool_call_update` carries non-empty `rawInput`. One fix corrects
both surfaces. NOT an SDK or FE change. Recommend folding it into the client-tool cleanup PR (same
runner area) to avoid a separate tiny PR — say if you'd rather it stand alone.

**Your decision: refresh fix APPROVED — go ahead** (folds into the cleanup, same runner area).
PLUS codex xhigh is reviewing `otel.ts` for a rename / refactor / reorganization (the name is
confusing; it is the runner's event recorder, not just telemetry); I will address his meaningful
points. (Batched with the thread-04 plan review.)

**Codex verdict (done):** don't just rename — SPLIT. The ACP state machine moves to a new
`engines/sandbox_agent/run-recorder.ts` (`createSandboxAgentRunRecorder`); the OTel span code stays
under `tracing/`; the Pi extension renames separately; functions rename
(`handleUpdate`->`handleAcpUpdate`, `record`->`recordRunEvent`, etc.). The refresh fix lands in
`handleToolCallUpdate` post-reorg. So this becomes its OWN planned refactor (plan-feature -> draft
PR -> your gate-1 LGTM -> implement), bundling the rename/refactor + the refresh fix — NOT folded
into the cleanup. Plan being written at `projects/otel-run-recorder-refactor/`.
