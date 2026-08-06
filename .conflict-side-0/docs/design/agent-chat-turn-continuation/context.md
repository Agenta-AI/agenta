# Context: duplicated turn blocks after tool approvals

## The symptom

Open the agent playground. Ask the agent to do something that needs a gated tool
(for example `commit_revision`). The agent streams its reasoning, its text, and the
tool call, then stops and asks for approval. Click Approve.

The agent continues. But the playground now shows the whole previous turn AGAIN as a
new block: same reasoning, same text, same tool chips, plus the continuation. Approve
a second gated tool and the same content stacks a third time. Each block carries its
own "Inspect turn" footer and its own token metrics, and the resumed blocks show
nonsense usage like `input: 0, output: 0, total: 62,749`.

Reported by Mahmoud on 2026-07-06 (session `67a00253-ac61-48ab-a907-4af49f059bd0`,
harness `claude`, runner `sidecar`). Root-cause research landed in
`docs/design/agent-workflows/scratch/approval-turn-duplication-findings.md`. This
workspace verifies that research against the source and designs the fix.

## Why this happens (one paragraph)

An unanswered approval intentionally ends the turn, destroys the sandbox session, and
closes the HTTP stream (the F-040 pause contract,
`services/runner/src/engines/sandbox_agent/pause.ts:1-27`). When the user approves,
the AI SDK client auto-resends the full message history as a brand-new POST. On that
resume, the client reuses the existing last assistant message as its streaming target:
it clones the message, full content included, and appends the new parts to the clone.
Whether the clone replaces the on-screen message or gets pushed as a duplicate hinges
on one identity check: does the streamed message id match the last message's id? Our
server mints a fresh id per HTTP request (`msg-{trace_id}`), so the check always
fails, and the clone lands as a second full copy. Every approval adds one more.

## Goals

- The playground shows one assistant turn that grows in place across approvals.
- No behavior change for normal turns, regenerate, rewind, or new user messages.
- The client-tool resume path (`request_connection`) gets the same fix for free.
- "Inspect turn" and per-turn metrics keep working when one message spans several
  traces, with the trade-offs stated explicitly.
- Unit tests pin the continuation rule in the SDK; a manual playground scenario
  verifies the end-to-end behavior.

## Non-goals

- The phantom `create_subscription` failure (root cause 2 in the findings doc: the
  one-pause latch drops sibling gates and the FE mints a fake "can't handle" error).
  Separate fix, separate design.
- The wrong usage numbers on resumed turns (`input: 0, output: 0, total: ~62k`).
  That is a runner-side ACP limitation (`services/runner/src/tracing/otel.ts:1185-1197`);
  this design only decides which request's usage a merged turn displays.
- Changing the F-040 pause contract (pause = end turn, destroy session, never reply).
- Aggregating per-turn metrics across resumes. Noted as follow-up in `fix-options.md`.

## Where to read next

- `research.md`: the full end-to-end explanation of message ids, the clone behavior,
  and the wire flows. Read this to understand the system.
- `fix-options.md`: the three fix options, the recommendation, and the
  trace-per-message implications.
- `plan.md`: implementation slices and the test plan.
- `status.md`: current progress.
