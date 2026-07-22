# Plan

This file turns the design into staged work. Each stage says what changes in each layer, who owns
each part, and how it is tested. Stage 1 deliberately packages storage and model perception into one
user-visible release, because shipping storage without perception would recreate the original bug in
a new form; the reason is spelled out in that stage.

The layers, and who owns each:

- **Front end** (`web/oss/src/components/AgentChatSlice/`, `web/packages/agenta-playground/`,
  `web/oss/src/components/Drives/`): collects the file, gates by capability, uploads it, sends the
  reference, and renders it.
- **API** (`api/oss/src/core/mounts/`, `api/oss/src/apis/fastapi/mounts/` and `.../sessions/`):
  stores the bytes, serves them, and enforces permissions.
- **Runner** (`services/runner/src/`): reads the original, writes the working copy, builds the content
  blocks, and gates on capability.
- **SDK** (`sdks/python/agenta/sdk/agents/`): carries the reference and the new `audio` block, and
  maps capabilities.

Stage 1 as specified below implements the recommended answer to the open product decision D11
(durable agent input; see [decisions.md](decisions.md)). If the product owner instead chooses image
perception only, Stage 1 shrinks to the inline-only version: the runner builds native image blocks
straight from the bytes on the wire, and the storage, reference, record-schema, and findability work
in this stage is deferred. The rest of the plan is written for the recommended option.

## Stage 0: block attachments until native delivery works (small, optional)

**Goal.** Stop the front end from accepting files until the runner can deliver them, by refusing an
attachment that would reach the dead end instead of accepting it.

- **Front end.** The paperclip is disabled, but paste and drag still add files
  (`AgentConversation.tsx`, the paste and drop handlers). Gate those two paths on the same condition
  as the paperclip so no file can be attached until the real feature lands. This removes the trap
  where a pasted screenshot looks accepted and is then ignored.
- **Tests.** A front-end unit test that a paste or drop of a file is refused while the feature flag
  is off.

This stage can be skipped if Stage 1 lands quickly.

## Stage 1: the first user-visible release (images perceived, files travel as references)

This stage packages two bodies of work (the attachment storage and reference handling, and the
runner's model-facing change) into one release, on purpose.

**Goal.** The model perceives images, and files travel as references rather than bytes. A person
attaches an image, the model sees it, the image is also on the agent's disk, the original stays
findable, and the wire no longer carries base64.

**Why these ship together and not separately.** Shipping storage alone, visibly, would let the UI
accept files that the model still ignores. That is the original bug in a new form: the person sees an
attachment go through and the agent acts as though it were not there. So the release is packaged so
that model perception and the attachment storage and reference handling land together, and the person
never sees an attachment UI that quietly does nothing.

**The minimum security and limits work belongs in this release, not later.** Session-binding checks,
forged-reference rejection, server-side media-type verification, per-file and per-turn size and count
limits, and time-to-live cleanup of never-referenced uploads are all part of Stage 1. They are not
polish for a later stage, because the first release already accepts files from a browser and stores
them, and an unauthenticated or unbounded version of that is not shippable.

**Deployment order inside the release.** The components deploy independently, so the order matters.

**(a) API first.** Build the attachment resource before anything depends on it.

- The create-only upload route: get-or-create the attachments mount, validate the file (size, count,
  media type verified server-side by inspecting the file bytes, not by trusting the client), write the bytes, and
  return `{attachment_id, filename, media_type, size}`. Refuse an overwrite or a delete of an
  existing attachment original, because `write_file` overwrites silently today
  ([design.md](design.md), decision D7).
- The download route the runner uses to read an original, with the session-binding check: the
  attachment must belong to the session being run, and a reference to another session's attachment is
  rejected ([design.md](design.md), decision D10).
- Per-file and per-turn size and count limits, enforced server-side.
- Time-to-live cleanup of uploads that are never referenced by a sent turn.
- The record-schema extension so a record can carry an attachment reference. Records are text-only
  today (see [research.md](research.md), section 7), so without this a reference cannot survive in the
  durable log. This is why the schema change is in the first release rather than deferred.

**(b) Runner second.** Once the API can store and serve, teach the runner to resolve and deliver.

- Dual-read during rollout. Dual-read means the runner accepts both the old inline-byte form and the
  new attachment-reference form during the rollout, so a runner deploy does not have to be
  simultaneous with the front-end switch.
- Resolution through the API: hand the `attachment_id` to the API download route and receive the
  bytes only when the binding checks out. The runner never sees storage coordinates.
- Materialize the working copy to the id-namespaced path `cwd/attachments/<attachment_id>/<filename>`,
  restoring it only when missing and never overwriting an edited copy ([design.md](design.md), The
  working-copy path and edited copies).
- Build ACP image blocks: replace the single text block at the `env.session.prompt(...)` call
  (`run-turn.ts`, currently near line 742, the one real call site) with the resolved list of content
  blocks. Update `resolvePromptText` and `messageText` callers so an image-with-no-text turn is valid
  instead of rejected.
- Structured capability errors: gate the image block on the mapped `images` capability, and on a
  contract violation fail the turn with a structured error code the front end can render, reusing the
  `assertRequiredCapabilities` and `*_UNSUPPORTED_MESSAGE` pattern in `capabilities.ts`. Never drop
  silently.
- A bounded cold-replay policy. Cold replay (rebuilding the conversation on a cold start) must set an
  explicit count and byte limit on how many historical attachments are re-delivered natively; beyond
  the limit, the working copy and a textual placeholder represent the file. Update the cold-replay
  path (`transcript.ts`) so a past image is no longer rendered as the string "[image]", within that
  budget (see the cold-replay budget below).

**(c) Front end last.** Once the API stores and the runner resolves, switch the browser over.

- Replace the inline base64 flow (`files.ts` `fileToPart`) with upload-through-the-API plus a
  reference in the message parts (`agentRequest.ts`).
- Render the person's own attachment by resolving the reference to a download URL, not from the
  base64 `data:` URL (`sessions.ts`), which is what removes the browser-storage pressure.
- Enable the attachment UI: the composer accepts a file, attaches it (workspace-only with a visible
  notice when the capability intersection does not allow native perception), and shows it.

**Tracing.** Because the history now carries a reference, the Python span no longer holds base64.
Confirm the trace shows the reference, not the bytes (the Python agent span keeps `messages` on
purpose, and a reference there is small).

**SDK / wire.** Add the attachment-reference form to the content block: it carries `attachment_id`,
`filename`, `media_type`, and `size`, and no bytes. Update `protocol.ts`, `wire.py`, both contract
tests, and the shared golden fixtures together, as the runner's wire contract requires (see
`services/runner/CLAUDE.md`).

**Tests.** These are listed in one place at the end of this file, under "Tests across the release,"
because they span the API, the runner, and the front end.

## Stage 2: audio and documents (blocked on adapter work)

**Goal.** Audio and documents reach the model, gated correctly.

**This stage is blocked on adapter work and cannot ship on the adapters we pin today.** From
[research.md](research.md), section 4: neither pinned adapter delivers native audio (neither
advertises the audio capability), the Claude adapter drops a document blob entirely, and the Pi
adapter renders a document blob as a byte count. So this stage is a plan for when the adapters
change, not work that can land against the current pins. `claude-agent-acp` is maintained by Zed and
`pi-acp` by the Pi project, so unblocking audio or native documents means an upstream release, a fork
we maintain, or a different harness.

**What would unblock it.**

- For audio: an adapter that advertises the audio capability and delivers an ACP audio block to the
  model. Until then there is nothing to deliver audio into.
- For documents: either adapter-native document handling (an adapter that turns an embedded resource
  into a real document input), or a deliberate decision to deliver documents as extracted text (the
  agent, or a pre-step, extracts the text and inlines it), which sidesteps native document delivery
  entirely.

**The work, once unblocked.**

- **SDK / wire.** Add an `audio` type to the Agenta content block, mapped in both directions in the
  Vercel adapter (`messages.py`), and mirrored in `protocol.ts`, `wire.py`, the contract tests, and
  the golden fixtures.
- **Runner.** Map audio to an ACP audio block and a document to whichever path the unblocking
  decision chooses, gated on the `audio` and `documents` capabilities respectively.
- **Capability names (alias rollout, not a simultaneous rename).** Retire the old `fileAttachments` and
  `file_attachments` names in favor of `images`, `audio`, and `documents`, and map ACP
  `embeddedContext` to `documents`. Do this as an alias rollout: introduce the new names alongside the
  old, keep the old names accepted as aliases through the rollout, and remove them later once every
  independently deployed component speaks the new names. A single rename landing in every component at
  once would break the versions in between (see [design.md](design.md), decision D5). The removal
  timing is an open
  question in [decisions.md](decisions.md).
- **Front-end limits.** Replace the placeholder limits (`attachments.ts` `DEFAULT_ATTACHMENT_LIMITS`)
  with limits derived from the selected model's real limits (see [research.md](research.md), section
  3), passed down in place of the default, which the file was already written to allow.
- **Tests.** SDK contract test for the `audio` block. Runner tests for audio and document blocks and
  their gates. A capability-contract test that the mapped set is consistent across the layers.
  Integration tests against whichever adapter version unblocks the stage.

## Stage 3: the Files-drawer listing and cleanup refinements

**Goal.** The "Shared by you" origin in the Files drawer, the reference-counting refinement of cleanup, the read-only
credential scope, and the edit-then-find flow verified end to end. The basic time-to-live cleanup
already ships in Stage 1; this stage refines it.

- **Front end (drawer).** Add "Shared by you" as a third origin over the attachments mount, reusing the
  existing provenance tagging in `DriveExplorer` (see [research.md](research.md), section 2). It is a
  new origin label, not a new panel.
- **API (cleanup refinement).** Stage 1 ships a time-to-live sweep of never-referenced uploads. Once
  records reliably carry references, add reference counting against the conversation records so a
  still-referenced upload is never swept and a truly orphaned one is removed promptly (the open
  question in [decisions.md](decisions.md) tracks this).
- **Hardening.** Add a read-only credential scope for the attachments mount, the strongest
  immutability guarantee and the path that would let the runner read the object store directly instead
  of through the API download route ([design.md](design.md), decision D7).
- **Tests.** An end-to-end check that after the agent edits its working copy, the original still opens
  unchanged under "Shared by you" and the agent's new file shows under the agent origin.

## Why the plan is shaped this way

The split of responsibilities, the reuse choices, and the sizing all follow from a few judgments,
stated here so a reviewer can challenge them.

**Responsibilities are split cleanly.** The front end collects, gates, uploads, and renders. The API
stores, serves, and enforces permissions. The runner reads the original, materializes the working
copy, and turns references into model content. The SDK carries the reference and the block types. No
layer reaches across into another's job: the runner never talks to the browser's storage, the front
end never builds ACP blocks, the API never knows about ACP. The one place to watch is the capability
mapping, which touches four layers, so the layered contract in [design.md](design.md) is the single
source and the old names retire through an alias rollout, keeping mixed component versions working
during the change.

**Engineering and architecture practice.** The design reuses the existing mounts substrate rather
than inventing storage, follows the established pattern of a separate mount for a separate lifecycle
(the agent-files precedent), and reuses the existing capability-gate pattern for the failure case.
Nothing here is a new architectural concept; it is a new use of concepts already in the code.

**Tradeoffs are stated, not hidden.** Every major choice in [design.md](design.md) lists its options
and what breaks under each. The lifecycle tradeoff is the clearest example: an attachment could have
lived in a `cwd` subfolder on lifecycle grounds, and only the findability requirement forces its own
mount.

**Scale and extensibility, sized for a first version with room to grow.** The reference-on-the-wire
change removes the quadratic resend cost, the browser storage pressure, and the trace bloat, so the
first version already scales better than today. The materialize step runs once per file per session.
The design grows into the harder modalities by adding block types, not by reworking the model-facing
call. Shipping the inline-only version first would avoid rework at that one call, though not the rest
of the system-wide change (decision D9). What is deliberately left for later is stated in
[scope.md](scope.md): video, assistant-produced files, cross-session reuse, and storage optimizations
like deduplication and thumbnails.

**Fit with the current architecture.** The change lives at the boundaries that already exist: the one
`session.prompt` call in the runner, the existing mount routes, the existing content-block adapter,
the existing capability probe, and the existing provenance tagging in the drawer. It does not
introduce a parallel system beside any of these.

## Four guarantees the stages must not lose

These four points are each covered inside a stage above, but they are the kind of detail that gets
dropped during implementation, so they are restated here as explicit checks.

- **Immutability is enforced server-side, not only by hiding the mount.** Originals enter only
  through the create-only upload route, the API refuses overwrite and delete of an original (because
  `write_file` overwrites silently today), and no signed credentials are ever issued for the
  attachments mount (because any signed credential is read-write today) ([design.md](design.md),
  decision D7). A read-only credential scope is the Stage 3 hardening follow-up.
- **Re-materialization is defined behavior.** If the agent deleted its working copy and a later turn
  references the file, the runner re-reads the original and writes the copy again; it never overwrites
  an edited working copy (Stage 1). Model delivery never depends on the working copy, and always reads
  the original.
- **The capability contract is one layered model across every layer.** The layered contract in
  [design.md](design.md) is the single source, and the old capability names retire through an alias
  rollout (Stage 2), never a rename that must land in every component at the same time, so no
  independently deployed component is ever left
  speaking a name the others do not.
- **An attach never silently drops, and a turn fails only on a contract violation.** An unsupported
  kind becomes a workspace-only attachment with a visible notice, and the runner fails the turn only
  when asked to deliver a native block the harness cannot accept ([design.md](design.md), decision D6;
  Stage 1).

## The tracing change

The tracing improvement in Stage 1 is not a separate task; it follows directly from the
reference-based message format. Once the saved history carries a reference instead of bytes, the
Python agent span (which keeps `messages` on purpose and has no length cap) holds a small reference
rather than a base64 blob. Confirm this in Stage 1 rather than adding a truncation cap, since the
cause is removed at the source.

## The cold-replay budget

On a cold start the runner rebuilds the conversation from records, and a historical attachment cannot
be re-sent freely. The policy: on a cold start only the working copies (already on disk) and textual
placeholders represent historical attachments by default. Re-delivering a historical attachment as a
native block again is bounded, and the bound is defined in implementation (for example, only the most
recent few native attachments, or only those within a size budget). The reason is a hard limit:
replaying a long conversation that re-sends every past image natively would exceed the provider's
per-request size and block limits (see [research.md](research.md), section 3). So historical native
re-delivery is capped, and older attachments fall back to their working copy and a textual
placeholder.

## Tests across the release

These tests span the API, the runner, and the front end, so they are listed together rather than
under a single stage.

**Model perception and the seam.**

- An image-and-text turn produces an image block and a text block.
- An image-only turn is valid instead of rejected.
- A cold replay of a past image no longer emits the string "[image]".
- Run integration tests against the two pinned adapters (`@agentclientprotocol/claude-agent-acp` and
  `pi-acp`) confirming that an inline image reaches the model as a real image.

**Storage, references, and the wire.**

- Add an SDK contract test for the attachment-reference form against the golden fixture.
- Test that a picked file uploads once and the message carries a reference with no `data:` URL.
- Verify that a saved-and-reloaded message still renders the file from the reference.

**Security and authorization.**

- A reference to another session's attachment is rejected (foreign-session rejection).
- A forged reference (an id that does not resolve to the caller's session) is rejected.
- An overwrite attempt against an existing original is refused, and a delete attempt against an
  original is refused.
- A browser-supplied media type that disagrees with the type the server inspected from the bytes does
  not win; the server's verified type is authoritative.

**Limits and cleanup.**

- Per-file and per-turn size and count limits are enforced server-side.
- An upload retry after a transient failure does not create a duplicate or a partial original.
- An abandoned upload (never referenced by a sent turn) is swept by the time-to-live cleanup.

**Resolution and materialization.**

- Resolver failure paths: a missing attachment, expired authorization, and a timeout each surface a
  structured error, not a silent drop.
- Materialization is atomic and never overwrites an edited working copy.
- Two attachments with the same filename in one session do not collide (the id-namespaced path).
- Warm resume and cold replay both work with references, within the cold-replay budget above.
