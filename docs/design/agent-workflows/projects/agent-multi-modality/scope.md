# Scope

## In scope

This scope describes the recommended answer to open decision D11 (see [decisions.md](decisions.md));
if the product owner chooses the smaller first release, the storage and findability items move out of
the first release.

- A person can attach an image, an audio clip, or a document to an agent message.
- The model perceives images natively (this works end to end on both pinned adapters). Native audio
  and native document delivery are goals, but they do not work on the adapters we run today and are
  blocked on adapter work (see [research.md](research.md), section 4, and [decisions.md](decisions.md),
  D8, open question 2 for audio, and the "Settled by evidence" section for document delivery).
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
  ([decisions.md](decisions.md), D6). The exact promise of the first release is the open product
  decision D11.

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
- **Transcoding.** This project will not convert files between formats before delivery (for example
  turning a video into frames); that work belongs with future video support.

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
- **Front-end limits derived from real model limits.** Replace the placeholder limits with values
  computed from the selected model (see [research.md](research.md), section 3). Started in Stage 2 and
  can be refined further as provider limits change.

## Next steps

- The product owner decides the open product question D11 (what the first release promises) on the PR.
- The document-delivery question is answered: documents do not arrive natively today (the Claude
  adapter drops blobs and the Pi adapter renders a byte count), so documents are a Stage 2 blocker on
  adapter work, not an open harness check (see [research.md](research.md), section 4).
- The runner-rebuilds-context-from-records direction is tracked in
  [issue #5443](https://github.com/Agenta-AI/agenta/issues/5443); it stays outside this project's
  scope (see [research.md](research.md), section 7).
- Decide whether Stage 0 ships on its own or folds into Stage 1.
