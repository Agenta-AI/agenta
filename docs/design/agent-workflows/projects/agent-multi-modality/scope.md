# Scope

## In scope

This scope implements decision D11 (see [decisions.md](decisions.md)): durable agent input from the
first release. No inline-only version will be built.

- A person can attach an image, an audio clip, or a document to an agent message. This covers files
  shared through the chat composer only: a file dragged into the Files drawer uploads directly to
  that mount through the existing drive flow and is not an attachment
  ([decisions.md](decisions.md), D13).
- The model perceives images natively (this works end to end on both pinned adapters). Native audio
  and native document delivery do not work on the adapters we run today and are blocked on adapter
  work (see [research.md](research.md), section 4, and [decisions.md](decisions.md), D8 and the
  "Settled by evidence" section). For audio, the first release ships the composer's browser
  dictation only (live speech becomes composer text, merged dark in PR #5458); a recorded voice
  message or uploaded audio file is a workspace-only attachment with the D6 visible notice, and no
  transcript reaches the model ([decisions.md](decisions.md), D14). Server-side transcription is a
  deferred follow-up, and native ACP audio delivery is the last upgrade.
- The agent can always work on the file, because a working copy is written into its working directory
  regardless of whether the model can perceive the file.
- Every shared file stays findable: the original never changes, renders inline in the conversation,
  and can be downloaded as exact bytes. Listing it under a "Shared by you" origin in the Files drawer
  is Stage 3 work.
- Files travel as an opaque, server-issued `attachment_id` on the wire, in the saved history, and in
  the traces, not as bytes and not as raw storage coordinates ([decisions.md](decisions.md), D10).
- Attaching a file never silently does nothing. An unsupported kind is attached as a workspace-only
  file with a visible notice, and the runner fails a turn only on a contract violation, such as a
  stale front end asking for a native block the harness cannot accept
  ([decisions.md](decisions.md), D6).

## Out of scope (for now)

- **Video.** No current model we target except Gemini perceives video, and ACP's content model has no
  video type. Video needs new protocol and adapter support and waits until there is a clear need and a
  supported harness.
- **Assistant-produced files as a first-class chip.** This project will not add an inline element for
  files the agent produces, a first-class "here is a file" chip in its answer. The runner protocol
  declares a `file` event type but nothing emits it (see [research.md](research.md), section 8). The
  agent can already write files into its working directory and the drawer already lists them; the
  missing piece is the inline chip, which is separate work.
- **Cross-session attachment reuse.** This project will not let a person pick a file shared in an
  earlier session and reattach it. Attachments are session-scoped, so an "attach from a past session"
  picker is a later feature.
- **Deduplication by content.** This project will not store one copy for identical uploads when the
  same file is shared twice. This is a storage optimization, not a correctness need, so it waits.
- **Thumbnails and previews generated server-side.** The server will not generate preview images for
  large files. This is a polish item that does not block the core flow.
- **Transcoding.** This project will not convert media files between formats before delivery (for
  example turning a video into frames); that work belongs with future video support. Server-side
  audio transcription is deferred separately ([decisions.md](decisions.md), D14), and when it ships
  it will not be transcoding either: the recording stays stored and delivered unchanged, and the
  transcript is an addition, not a replacement.
- **Server-side transcription of recorded audio.** Deferred out of the first release by D14: no
  transcription endpoint, no key resolver, no platform key, no metering. Listed again under
  follow-ups below with the pointer to the survey.

## Follow-ups

- **Large pasted text becomes a file.** When a person pastes a very large block of text into the chat
  box, it should not be sent through the prompt as text. It should be saved as a file and referenced in
  the prompt, the same way an attachment is. Where exactly it is saved is likely answered by the
  attachments mount this project builds. This is a natural extension of the reference model and is
  listed as a follow-up rather than in the core scope.
- **A clean reference chip in the composer.** When a file is attached, the composer should show the
  reference in a clear, readable way (a chip with the filename and kind) rather than a raw preview.
  This is a presentation improvement on top of the core flow.
- **A read-only credential scope for the attachments mount.** The strongest form of the immutability
  guarantee, noted in [design.md](design.md), decision D7, and [plan.md](plan.md), Stage 3.
- **Front-end limits derived from real model limits.** Replace the static default limits with values
  computed from the selected model (see [research.md](research.md), section 3). Started in Stage 2 and
  can be refined further as provider limits change.
- **Server-side transcription of recorded audio.** The deferred middle step between browser
  dictation and native ACP audio ([decisions.md](decisions.md), D14). The survey it restarts from
  (the litellm call path Agenta already runs, prices, who has a usable key) is in
  [research.md](research.md), section 4, "Server-side transcription, surveyed and deferred".
- **Per-workspace retention policies.** The settled retention rule ties originals to the session
  lifecycle ([decisions.md](decisions.md), "Settled by evidence"). A policy such as "purge
  attachments after N days" for compliance customers is a separate feature: it needs a policy
  setting, a sweep job, and a story for the holes it leaves in old conversations whose references
  no longer resolve.
- **User-initiated purge of a single original.** Removing one wrongly shared file before its
  session ends needs a product surface plus a revoked-reference marker in the records, so a replay
  cannot re-materialize the purged bytes.
- **Runner-side downscaling of oversized images.** Today an accepted image that exceeds a
  provider's inline cap is delivered workspace-only with the D6 notice ([design.md](design.md),
  "The media-type, validation, and limits matrix"). Downscaling it to fit the cap would restore
  guaranteed perception for those files, at the cost of new image-processing machinery in the
  runner.

## Next steps

- Implementation starts with Stage 0 or Stage 1 of [plan.md](plan.md); every product decision (D1
  through D14) is taken.
- The document-delivery question is answered: documents do not arrive natively today (the Claude
  adapter drops blobs and the Pi adapter renders a byte count), so documents are a Stage 2 blocker on
  adapter work, not an open harness check (see [research.md](research.md), section 4).
- The runner-rebuilds-context-from-records direction shipped with the session-storage rework
  (PR #5560, tracked as [issue #5443](https://github.com/Agenta-AI/agenta/issues/5443)); the
  rebuild itself stays outside this project's scope (see [research.md](research.md), section 7).
- Decide whether Stage 0 ships on its own or folds into Stage 1.
