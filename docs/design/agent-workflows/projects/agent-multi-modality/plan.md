# Plan

This file turns the design into staged work. Each stage says what changes in each layer, who owns
each part, and how it is tested. Stage 1 deliberately packages storage and model perception into one
user-visible release, because shipping storage without perception would recreate the original bug in
a new form; the reason is spelled out in that stage.

The layers, and who owns each:

- **Front end** (`web/oss/src/components/AgentChatSlice/`, `web/packages/agenta-playground/`,
  `web/oss/src/components/Drives/`): collects the file, gates by capability, uploads it, sends the
  reference, and renders it. The collection and rendering surface is already merged dark (see "What
  is already built" below); the remaining front-end work is transport and reference wiring.
- **API** (`api/oss/src/core/mounts/`, `api/oss/src/apis/fastapi/mounts/` and `.../sessions/`):
  stores the bytes, serves them, and enforces permissions.
- **Runner** (`services/runner/src/`): reads the original, writes the working copy, builds the content
  blocks, and gates on capability.
- **SDK** (`sdks/python/agenta/sdk/agents/`): carries the reference and the new `audio` block, and
  maps capabilities.

Stage 1 implements decision D11: durable agent input from day one (see
[decisions.md](decisions.md)). No inline-only version will be built, so the storage, reference,
record-schema, and findability work below is first-release work, not a later addition.

## What is already built (merged dark)

The front-end surface of this design shipped ahead of the backend, in PRs
[#5458](https://github.com/Agenta-AI/agenta/pull/5458) (voice input) and
[#5459](https://github.com/Agenta-AI/agenta/pull/5459) (attachments and drive uploads), both merged
2026-07-29. It is dark behind two flags, `NEXT_PUBLIC_AGENT_FILE_UPLOADS` (the composer attach
button, the attachment preview, and every drive-upload entry point) and
`NEXT_PUBLIC_AGENT_VOICE_INPUT` (dictation and voice messages), both off by default. All paths
verified against the code on 2026-07-31:

- The composer attach UI and attachment chips (`AgentConversation.tsx`, `ComposerAttachments.tsx`).
- The limits object: `DEFAULT_ATTACHMENT_LIMITS` in
  `web/oss/src/components/AgentChatSlice/assets/attachments.ts` allows 100 files per turn, 10 MB
  per image, 15 MB per audio clip, and 10 MB per document, with per-kind media-type validation.
- The upload lifecycle hook `useAttachmentUploads`, with a deliberate transport seam: no uploader
  is passed today, so files stage as ready-to-send; providing an uploader runs the whole
  progress, failure, and retry flow with no other change.
- Attachment preview (the `AttachmentViewerDrawer`) and the Files drawer upload surfaces (upload
  button, drop-to-upload, drop-to-stage on a recents peek) in `Drives/DriveExplorer.tsx`.
- The voice capture UI: dictation (`useVoiceInput`, the Web Speech API turning live speech into
  composer text) and voice messages (`useAudioRecorder`, `VoiceInputButton`, `RecordingBar`), which
  land a recording in the attachment tray like any file.

Two consequences shape the stages below. First, Stage 1 front-end work shrinks to wiring: the
collection UI exists and only its transport and rendering change. Second, paste and drag-to-attach
on the composer predated the flags and ran ungated, which was the Stage 0 gap. Stage 0 has since
closed it, so every composer path now respects `NEXT_PUBLIC_AGENT_FILE_UPLOADS`.

Drive uploads are deliberately not part of the attachment pipeline: a file dropped into the Files
drawer writes directly to that mount at that path, and only files shared through the composer
become attachments (decision D13 in [design.md](design.md)).

## Stage 0: gate the ungated paste and drag path (complete)

**Goal.** Stop the front end from accepting files until the runner can deliver them, by refusing an
attachment that would reach the dead end instead of accepting it.

**Complete, 2026-07-31, in commit `f2aa193cb2` on
[PR #5604](https://github.com/Agenta-AI/agenta/pull/5604), and verified live in both flag states.**
What was done, the implicit decisions it forced, and the QA record are in
[protocols/stage-0.md](protocols/stage-0.md).

- **Front end.** The attach button, preview, and drive uploads were already behind
  `NEXT_PUBLIC_AGENT_FILE_UPLOADS`, but paste and drag-to-attach on the composer predated the flag
  and ran ungated (`AgentConversation.tsx`, the paste and drop handlers). The shared
  `attachmentsBlocked` guard now includes `!uploadsEnabled`, which gates the drag, drop, and paste
  handlers through the mechanism the composer already used for its other blocked states. This
  removes the trap where a pasted screenshot looks accepted and is then ignored.
- **Tests.** Covered by the live check in both flag states recorded in the protocol rather than by
  a new front-end unit test.

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
them, and an unauthenticated or unbounded version of that is not shippable. On limits specifically:
enforcement today is client-side only (the merged `DEFAULT_ATTACHMENT_LIMITS`: 100 files per turn,
10 MB images, 15 MB audio, 10 MB documents), which a client can bypass, so the server-side check
belongs to the new upload route. The exact rules are settled: the matrix in
[design.md](design.md), "The media-type, validation, and limits matrix", defines the per-kind
formats, caps, and count, the inspected-type-wins mismatch rule, and the workspace-only delivery
rule for an original that exceeds a provider's inline cap. The gateway decision is part of it: the
compose gateway request-body cap rises from 10 MB to 32 MB, and the route's per-kind caps stay the
enforced truth (the config task is listed under (a) below).

**Deployment order inside the release.** The components deploy independently, so the order matters,
and it is reader-first: every component that has to understand a new form ships before the component
that emits it. Four packages merge and deploy bottom to top, the API, the runner, the SDK with the
agent service, and the front end, and turning the flag on is a fifth act taken separately once the
first three are confirmed deployed. Reader-first is what keeps every intermediate state safe. A
content block the runner does not understand is structurally accepted and semantically ignored, so a
producer that shipped early would lose files silently; a consumer that ships early is dead code
nobody reaches yet.

**(a) API first.** Build the attachment resource before anything depends on it.

- The create-only upload route: get-or-create the attachments mount, validate the file against the
  settled matrix ([design.md](design.md), "The media-type, validation, and limits matrix": media
  type verified server-side by inspecting the file bytes, never by trusting the client; per-kind
  size caps; unrecognizable bytes rejected with a structured error), write the bytes, and
  return `{attachment_id, filename, media_type, size}`. Refuse an overwrite or a delete of an
  existing attachment original, because `write_file` overwrites silently today
  ([design.md](design.md), decision D7).
- Raise the compose gateway request-body cap to match the matrix: `client_max_body_size` from `10M`
  to `32m` in `hosting/docker-compose/oss/nginx/nginx.conf` (the only nginx config in the compose
  stack, mounted by the OSS gh compose files `docker-compose.gh.yml` and
  `docker-compose.gh.local.yml` behind the `with-nginx` profile; the dev stacks and the EE compose
  files run no nginx). The railway gateway already allows 32 MB
  (`hosting/railway/oss/gateway/nginx.conf`, verified 2026-07-31). The route-level per-kind caps
  are the enforced truth; the gateway is a ceiling.
- Upload idempotency and atomicity: a retried upload must not create a duplicate original and must
  not leave a partial one. The client sends an idempotency key alongside the file, unique per project
  and session. The route reads the body in bounded chunks, validates it, inserts a `pending` row
  carrying that key, writes the object, and only then marks the row `ready`; downloads and claims
  resolve `ready` rows and nothing else. So a retry with the same key after an ambiguous failure
  returns the same attachment instead of a second original, an upload still in flight is refused
  rather than raced, and a create that dies between the object write and the `ready` transition
  leaves nothing anyone can reach, with the reaper removing the row and its object afterwards. A
  resource that is never referenced by a sent turn is swept by the time-to-live cleanup below.
- The download route the runner uses to read an original, with the session-binding check: the
  attachment must belong to the session being run, and a reference to another session's attachment is
  rejected ([design.md](design.md), decision D10).
- Per-file size limits and the per-session quotas, enforced server-side at the create route, with
  the numbers from the settled matrix: 10 MB per image, 15 MB per audio clip, 10 MB per document
  and per other kind. The per-turn count of 100 is the runner's to enforce over the current user
  turn, since each upload is its own request (the matrix in [design.md](design.md)).
- Time-to-live cleanup of uploads that are never referenced by a sent turn.
- The record-schema extension so a record can carry an attachment reference. Records are text-only
  today (see [research.md](research.md), section 7), so without this a reference cannot survive in the
  durable log. This is why the schema change is in the first release rather than deferred.

**(b) Runner second.** Once the API can store and serve, teach the runner to resolve and deliver.

- Give the runner a first-class notion of the current user turn, before anything else in this step.
  It has none today: `resolvePromptText` scans backward for the most recent non-empty user text
  (`protocol.ts`), so an attachment-only turn that follows a text turn resends the earlier text. The
  same assumption sits in the tail-freshness check, in the history fingerprint (which hashes user
  text and no attachment ids, so two turns differing only in their files collide), and in the
  inbound-record persist guard. Every item below reads the current turn, so this abstraction lands
  first; `resolvePromptText` stays afterwards as what it really is, the approval-resume fallback.
- Dual-read during rollout. Dual-read means the runner accepts both the old inline-byte form and the
  new attachment-reference form during the rollout, so a runner deploy does not have to be
  simultaneous with the front-end switch.
- Resolution through the API: hand the `attachment_id` to the API download route and receive the
  bytes only when the binding checks out. The runner never sees storage coordinates.
- Materialize the working copy to the id-namespaced path `cwd/attachments/<attachment_id>/<filename>`,
  restoring it only when missing and never overwriting an edited copy ([design.md](design.md), The
  working-copy path and edited copies).
- Build ACP image blocks: replace the single text block at the `env.session.prompt(...)` call
  (`run-turn.ts`, currently line 803, the one real call site) with the resolved list of content
  blocks. The rejection of a text-free turn lives in `run-plan.ts`, and it reads the current turn's
  attachments too, so an image-with-no-text turn becomes valid instead of rejected.
- Structured capability errors: gate native delivery on the full D5 three-layer intersection, not
  on a single flag. The runner must check all three layers before building a native block: the ACP
  transport flag the adapter advertises (already probed and mapped in `capabilities.ts`), the
  adapter fidelity for that kind (a static fact per pinned adapter version, from
  [research.md](research.md), section 4), and the selected model's modalities. The first two the
  runner already holds or can hard-code per pin; the third is a new implementation input: the run
  request already carries the selected model (`protocol.ts`, the `model` field), and the SDK's
  model catalog records each model's modalities (`sdks/python/agenta/sdk/agents/model_catalog.py`,
  the `modalities` field, backed by the data files in `sdks/python/agenta/sdk/agents/data/`), so
  the wire needs to carry the selected model's modalities to the runner, or the runner needs an
  equivalent lookup. On a contract violation fail the turn with a structured error code the front
  end can render, reusing the `assertRequiredCapabilities` and `*_UNSUPPORTED_MESSAGE` pattern in
  `capabilities.ts`. Never drop silently.
- The mention-first cold-replay policy (decision D12 in [design.md](design.md)). Cold replay
  (rebuilding the conversation from the durable records on a cold start) represents a historical
  attachment as a textual mention carrying the real filename and the working-copy path
  (`cwd/attachments/<attachment_id>/<filename>`), never as inline re-delivery, so nothing inline
  grows with the history and no size budget is needed. At cold start the runner re-materializes the
  working copy of every attachment referenced in the session's records, restoring only what is
  missing and never overwriting an edited copy, so every mentioned path exists. Inline native
  delivery is reserved for the attachments referenced by the turn actually being run. Update the
  cold-replay path (the record fold in `services/runner/src/sessions/reconstruct.ts`, which rebuilds
  a past user turn as text only today, and the transcript flattening in `transcript.ts`) so a past
  image becomes that mention instead of being dropped from the rebuilt turn (see the cold-replay
  policy below).

**(c) The SDK and the agent service third.** The SDK is what produces the new content block, so it
ships once the runner already understands it. A browser file part carrying an attachment id becomes
an attachment block on the way in; the resolved connection puts the selected model's input modalities
on the wire, which is the fact the runner's third capability layer reads; and the delivery outcome
travels back through `wire.py` and the Vercel stream to the browser. The wire shape is under "SDK /
wire" below. This is its own package because shipping it is two rollout events, a package publish and
an agent-service deploy, rather than one.

**(d) Front end fourth.** Once the API stores, the runner resolves, and the SDK produces, switch the
browser over. The collection UI is already merged dark (see "What is already built"), so this is
wiring work, not UI work:

- Wire the transport seam to the new upload route: pass a real uploader to `useAttachmentUploads`
  (today none is passed, so the progress, failure, and retry flow is inert by design).
- Send references instead of base64 `data:` URLs: replace the inline flow (`files.ts`
  `fileToPart`) with the uploaded attachment's reference in the message parts (`agentRequest.ts`).
- Render the person's own attachment by resolving the reference through the download route, not
  from the base64 `data:` URL (`sessions.ts`), which is what removes the browser-storage pressure.
- Stop rejecting unknown kinds in the composer: today `validateIncoming` refuses a file whose type
  maps to no kind ("isn't a supported file type", `attachments.ts`, line 131), which contradicts
  decision D6. Accept every kind, and show the workspace-only notice instead, per the matrix in
  [design.md](design.md).

**(e) Turning the flag on, last and on its own.** `NEXT_PUBLIC_AGENT_FILE_UPLOADS` is configuration,
not code, so the front end merges with it still off in production and the flip is a separate act
taken once (a), (b), and (c) are confirmed deployed. Then the composer accepts a file, attaches it
(workspace-only with a visible notice when the capability intersection does not allow native
perception), and shows it. Stage 0's gating of the paste and drag path keys off the same flag, so
enabling it opens every entry point together.

**Tracing.** Because the history now carries a reference, the Python span no longer holds base64.
Confirm the trace shows the reference, not the bytes (the Python agent span keeps `messages` on
purpose, and a reference there is small).

**SDK / wire.** Add the attachment-reference form to the content block: it carries `attachment_id`,
`filename`, `media_type`, and `size`, and no bytes. Update `protocol.ts`, `wire.py`, both contract
tests, and the shared golden fixtures together, as the runner's wire contract requires (see
`services/runner/CLAUDE.md`).

**Tests.** These are listed in one place at the end of this file, under "Tests across the release,"
because they span the API, the runner, and the front end.

## Stage 2: the audio release, documents when adapters allow

**Goal.** The voice UI turns on with browser dictation as the only audio-to-text, a recorded clip
follows the D6 workspace-only path (decision D14 in [design.md](design.md)), and documents are
planned for when the adapters change.

**Audio: turn on what is built. Not blocked.** Dictation needs no new work: the composer's
dictation mode (`useVoiceInput`, the Web Speech API) already turns live speech into composer text
and is merged dark (PR #5458). The Stage 2 audio work is:

- Ensure a recorded voice message and an uploaded audio file follow the D6 workspace-only path: the
  recording travels through the Stage 1 attachment pipeline unchanged (uploaded once, stored as an
  immutable original, materialized as a working copy, referenced in the records), and the composer
  shows the visible notice that the model will not hear it. No transcript is produced or sent.
- Turn on `NEXT_PUBLIC_AGENT_VOICE_INPUT`: the voice capture UI (dictation and voice messages) is
  already merged dark (PR #5458) and lands its recording in the attachment tray like any file.

**Server-side transcription is deferred, not Stage 2 work.** The first release adds no
transcription endpoint, no key resolver, no platform key, and no metering (decision D14). The
survey a follow-up starts from (the litellm call path, prices, who has a usable key) is in
[research.md](research.md), section 4 ("Server-side transcription, surveyed and deferred").

**Native audio is the last upgrade, not Stage 2 work.** The `audio` type on the Agenta content
block (mapped in the Vercel adapter `messages.py` and mirrored in `protocol.ts`, `wire.py`, the
contract tests, and the golden fixtures) and the runner's mapping to the ACP audio block wait until
an adapter advertises the `audio` capability. Neither pinned adapter does, and the Anthropic
Messages API has no audio input at all ([research.md](research.md), section 4), so that upgrade has
no date and nothing in this stage depends on it.

**Documents: blocked on adapter work.** From [research.md](research.md), section 4: the Claude
adapter drops a document blob entirely and the Pi adapter renders it as a byte count, so native
document delivery cannot ship on the adapters we pin today. `claude-agent-acp` is maintained by Zed
and `pi-acp` by the Pi project, so unblocking documents means an upstream release, a fork we
maintain, or a different harness. What would unblock it: either adapter-native document handling
(an adapter that turns an embedded resource into a real document input), or a deliberate decision
to deliver documents as extracted text (the agent, or a pre-step, extracts the text and inlines
it), which sidesteps native document delivery entirely. Once unblocked, the runner maps a document
to whichever path that decision chooses, gated on the `documents` capability.

**Shared Stage 2 work.**

- **Capability names (alias rollout, not a simultaneous rename).** Retire the old `fileAttachments` and
  `file_attachments` names in favor of `images`, `audio`, and `documents`, and map ACP
  `embeddedContext` to `documents`. Do this as an alias rollout: introduce the new names alongside the
  old, keep the old names accepted as aliases through the rollout, and remove them later once every
  independently deployed component speaks the new names. A single rename landing in every component at
  once would break the versions in between (see [design.md](design.md), decision D5). The removal
  timing needs no separate decision: remove the aliases once every component's deployed version
  speaks the new names, confirmed per component. The pip-installed SDK is the gating one, since
  user-held versions upgrade on their own schedule, so the removal follows a standard deprecation
  window rather than a fleet deploy.
- **Front-end limits.** Replace the static defaults (`attachments.ts` `DEFAULT_ATTACHMENT_LIMITS`)
  with limits derived from the selected model's real limits (see [research.md](research.md), section
  3), passed down in place of the default, which the file was already written to allow.
- **Tests.** A recorded clip uploads as a normal attachment, the turn proceeds workspace-only with
  the visible notice, and nothing audio-derived reaches the model inline. A capability-contract
  test that the mapped set is consistent across the layers. Runner tests
  for the document path and its gate, plus the SDK contract test for the `audio` block, once their
  respective adapter work unblocks.

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
- **Retention.** Covered by the session lifecycle, settled in [decisions.md](decisions.md), "Settled
  by evidence": originals are deleted when the session is deleted and kept as long as it exists,
  including while archived. The existing session-mount teardown already implements this
  (`delete_session_mounts` and `archive_session_mounts` in `api/oss/src/core/mounts/service.py`),
  so the Stage 3 work is one test asserting the attachments mount is included in that teardown.
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

**Scale and extensibility, sized for a first version with room to grow.** The resend cost, which
could grow quadratically in the worst case, is already gone, independently of this design: since the
session-storage rework (PR #5560) the front
end sends only the trailing message and the runner rebuilds prior turns from durable records. The
reference-on-the-wire change removes what remains: the browser storage pressure, the trace bloat,
and the attaching turn's own base64 weight, so the first version scales better than today. The materialize step runs once per file per session.
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

## The cold-replay policy

On a cold start the runner rebuilds the conversation from the durable records
(`services/runner/src/engines/sandbox_agent/reconstruct-history.ts`). The adopted policy is
mention-first (decision D12 in [design.md](design.md)): a historical attachment is represented by a
textual mention carrying its real filename and working-copy path, and the runner restores the
working copy of every attachment referenced in the session's records, so each mentioned path
exists. Inline native delivery happens only for attachments referenced by the turn being run. No
count or byte budget is needed, because nothing inline grows with the length of the history; a
mentioned file is one tool call away, since the harnesses' read tools deliver an image from disk on
all three harnesses, and a PDF on Claude (see [research.md](research.md), section 4).

## Tests across the release

These tests span the API, the runner, and the front end, so they are listed together rather than
under a single stage.

**Model perception and the seam.**

- An image-and-text turn produces an image block and a text block.
- An image-only turn is valid instead of rejected.
- A cold replay of a past image no longer emits the string "[image]"; it emits the mention with the
  real filename and working-copy path, and that path exists after the cold-start sweep.
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

- Per-file and per-turn size and count limits are enforced server-side, with the numbers and the
  boundary behavior from the matrix in [design.md](design.md): a file over its kind's cap is
  rejected at upload with a structured error, and unrecognizable bytes are rejected as an invalid
  file.
- Deleting a session tears down its attachments mount with the other session mounts, and archiving
  keeps the originals (the retention rule in [decisions.md](decisions.md), "Settled by evidence").
- An upload retry after a transient failure does not create a duplicate or a partial original.
- An abandoned upload (never referenced by a sent turn) is swept by the time-to-live cleanup.

**Resolution and materialization.**

- Resolver failure paths: a missing attachment, expired authorization, and a timeout each surface a
  structured error, not a silent drop.
- Materialization is atomic and never overwrites an edited working copy.
- Two attachments with the same filename in one session do not collide (the id-namespaced path).
- Warm resume and cold replay both work with references, under the mention-first policy above: a
  rebuilt turn carries the mention with the real path, and every mentioned working copy exists after
  the cold-start sweep.
