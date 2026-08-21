# Status

This file records the project's current state.

## State

The design is complete. Every decision, D1 through D14, is taken; the last four (D11 durable agent
input from day one, D12 mention-first cold replay, D13 two upload surfaces, D14 first-release audio
is browser dictation only) were decided on 2026-07-31. What remains open are implementation-time
questions, not product questions; see [decisions.md](decisions.md) for the list. The next step is
implementation, starting with Stage 0 or Stage 1 of [plan.md](plan.md).

The one-line problem: agent workflows are text-only at the model. A file travels intact from the
chat box to the runner and is dropped at the one call that hands a turn to the harness
(`services/runner/src/engines/sandbox_agent/run-turn.ts`, the `session.prompt` call, currently near
line 742). The image fix is entirely on our side of that call, because both pinned adapters deliver
an image natively. Native audio and native documents are different: neither pinned adapter supports
them today, so those native paths are blocked on adapter work. For audio the first release ships
the composer's browser dictation only; a recorded clip is a workspace-only attachment with a
visible notice, and server-side transcription is deferred (decision D14).

The front-end surface is already merged dark (PRs #5458 and #5459, merged 2026-07-29): the composer
attach UI, the attachment chips and preview, the per-kind limits object, the upload lifecycle hook
with its unwired transport seam, the voice capture UI, and the drive-upload surfaces, behind
`NEXT_PUBLIC_AGENT_FILE_UPLOADS` and `NEXT_PUBLIC_AGENT_VOICE_INPUT` (both off by default). Paste
and drag-to-attach predate the flags and are live ungated, which is the Stage 0 gap.
`NEXT_PUBLIC_AGENT_VOICE_INPUT` and its per-user Settings toggle are now gone: dictation is
unconditional, and the voice-message mode is hidden behind the `VOICE_MESSAGE_MODE_ENABLED`
constant in `@agenta/chat`'s `VoiceInputButton` until its workspace-only delivery path lands. The backend
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
| 0 | Close the silent-failure gap: gate the ungated paste and drag path on `NEXT_PUBLIC_AGENT_FILE_UPLOADS` | in review (PR #5604) |
| 1 | First user-visible release: the attachment resource and storage, the record-schema extension, the runner's resolve-materialize-and-deliver seam for images, structured capability errors, the minimum security and limits work (per the settled matrix in [design.md](design.md), including the gateway raise to 32 MB), and the front-end transport and reference wiring | in review as four stacked PRs (#5607 API, #5615 runner, #5617 SDK, #5619 front end), end-to-end QA green on the dev stack; the trail is in [protocols/stage-1.md](protocols/stage-1.md) |
| 2 | The audio release: turn on the voice UI, dictation as the only audio-to-text, recordings on the D6 workspace-only path (D14); the document plan (blocked on adapter work), the capability-alias rollout, derived front-end limits | in progress — the voice UI is ungated and dictation ships with a push-to-talk chord (hold Ctrl+Option / Ctrl+Alt); recordings stay hidden behind `VOICE_MESSAGE_MODE_ENABLED` pending the D6 workspace-only path (documents blocked on adapter work) |
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
(D13); and first-release audio is browser dictation only, with recordings workspace-only under the
D6 notice, server-side transcription deferred, and native ACP audio as the last upgrade (D14).

## Open questions

See [decisions.md](decisions.md). All product decisions are taken. One implementation question
remains open: when cleanup moves from a time-to-live sweep to reference counting. Two former open
questions were settled by evidence on 2026-07-31 and moved to "Settled by evidence" in
[decisions.md](decisions.md): the media-type, validation, and limits matrix (the full matrix is in
[design.md](design.md), "The media-type, validation, and limits matrix", including the compose
gateway raise from 10 MB to 32 MB) and the retention rules (originals share the session lifecycle:
deleted with the session, kept while it exists, including archived). The capability-alias removal
is deliberately not on this list: it is rollout mechanics with a stated settle condition, recorded
in [plan.md](plan.md) Stage 2.

## Next actions

- Review and merge the Stage 1 train bottom-up (#5604, #5607, #5598, #5615, #5597, #5617,
  #5619), then flip `NEXT_PUBLIC_AGENT_FILE_UPLOADS` in production as the rollout's fifth act.
- Follow-ups recorded in [protocols/stage-1.md](protocols/stage-1.md): the CI report glob line
  (needs a workflow-scoped push), the Fern client regeneration, and the zip-container
  classifier refinement.
- Then Stage 2 of [plan.md](plan.md).

## Artifacts

- [README.md](README.md) · [context.md](context.md) · [research.md](research.md) ·
  [design.md](design.md) · [plan.md](plan.md) · [scope.md](scope.md) · [decisions.md](decisions.md)
- Branch: `docs/agent-multi-modality` (docs only).
- Merged front-end groundwork: PR #5458 (voice input), PR #5459 (attachments and drive uploads),
  both dark behind flags.
