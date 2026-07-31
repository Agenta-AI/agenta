# Status

This file records the project's current state.

## State

The design is complete. Every decision, D1 through D14, is taken; the last four (D11 durable agent
input from day one, D12 mention-first cold replay, D13 two upload surfaces, D14 interim audio via
transcription we own) were decided on 2026-07-31. What remains open are implementation-time
questions, not product questions; see [decisions.md](decisions.md) for the list. The next step is
implementation, starting with Stage 0 or Stage 1 of [plan.md](plan.md).

The one-line problem: agent workflows are text-only at the model. A file travels intact from the
chat box to the runner and is dropped at the one call that hands a turn to the harness
(`services/runner/src/engines/sandbox_agent/run-turn.ts`, the `session.prompt` call, currently near
line 742). The image fix is entirely on our side of that call, because both pinned adapters deliver
an image natively. Native audio and native documents are different: neither pinned adapter supports
them today, so those native paths are blocked on adapter work. Audio ships anyway in the interim:
the model receives a transcript we produce ourselves (decision D14).

The front-end surface is already merged dark (PRs #5458 and #5459, merged 2026-07-29): the composer
attach UI, the attachment chips and preview, the per-kind limits object, the upload lifecycle hook
with its unwired transport seam, the voice capture UI, and the drive-upload surfaces, behind
`NEXT_PUBLIC_AGENT_FILE_UPLOADS` and `NEXT_PUBLIC_AGENT_VOICE_INPUT` (both off by default). Paste
and drag-to-attach predate the flags and are live ungated, which is the Stage 0 gap. The backend
(upload route, attachment resource, record schema, runner delivery) has not started; see "What is
already built (merged dark)" in [plan.md](plan.md).

## Reading order

See [README.md](README.md). In short: [context.md](context.md) for the plain story,
[research.md](research.md) for the findings, [design.md](design.md) for the design and its options,
[plan.md](plan.md) for the staged work, [scope.md](scope.md) for in and out, and
[decisions.md](decisions.md) for the log and open questions.

## Stage tracker

| Stage | Scope | State |
| --- | --- | --- |
| 0 | Close the silent-failure gap: gate the ungated paste and drag path on `NEXT_PUBLIC_AGENT_FILE_UPLOADS` | not started (optional) |
| 1 | First user-visible release: the attachment resource and storage, the record-schema extension, the runner's resolve-materialize-and-deliver seam for images, structured capability errors, the minimum security and limits work, and the front-end transport and reference wiring | not started |
| 2 | Audio via transcription we own (D14), the document plan (blocked on adapter work), the capability-alias rollout, derived front-end limits | not started (documents blocked on adapter work) |
| 3 | Findability polish and cleanup: "Shared by you" origin, reference-counting cleanup refinement, read-only credential scope, verify the edit-then-find flow | not started |

## Decisions taken

See the decision log in [decisions.md](decisions.md) (D1 through D14, all decided). In brief:
deliver inline for perception and on disk for tool use; keep the original in a dedicated session
mount out of the sandbox; two copies, an unchanging original and a disposable working copy; compute
the capability as the intersection of transport, adapter fidelity, and model, and gate in the
composer and the runner; never silently drop, attach an unsupported kind as workspace-only, and fail
the turn only on a contract violation; enforce immutability through a create-only upload route with
no signed credentials for the mount; carry an opaque server-issued `attachment_id` on the wire
(D10); the first release promises durable agent input, not image perception alone (D11); cold replay
is mention-first (D12): a historical attachment is a textual mention with its real working-copy
path, every referenced working copy is restored at cold start, and inline delivery is reserved for
the running turn; drawer uploads and composer attachments are deliberately different pipelines
(D13); and interim audio is transcription we own, with native ACP audio as a later upgrade (D14).

## Open questions

See [decisions.md](decisions.md). All product decisions are taken. The five open implementation
questions are: which service transcribes audio and when transcription runs; when the old capability
names are removed across independently deployed components; the retention rules when a session is
archived or deleted; the exact media-type, validation, and limits matrix (including the server-side
limits and the gateway's 10 MB request-body cap); and when cleanup moves from a time-to-live sweep
to reference counting.

## Next actions

- Start implementation: Stage 1 of [plan.md](plan.md), optionally preceded by Stage 0.
- Decide whether Stage 0 ships on its own or folds into Stage 1.
- Settle the media-type, validation, and limits matrix while building the Stage 1 upload route, and
  the transcription service and trigger while building the Stage 2 audio work
  ([decisions.md](decisions.md), open questions).

## Artifacts

- [README.md](README.md) · [context.md](context.md) · [research.md](research.md) ·
  [design.md](design.md) · [plan.md](plan.md) · [scope.md](scope.md) · [decisions.md](decisions.md)
- Branch: `docs/agent-multi-modality` (docs only).
- Merged front-end groundwork: PR #5458 (voice input), PR #5459 (attachments and drive uploads),
  both dark behind flags.
