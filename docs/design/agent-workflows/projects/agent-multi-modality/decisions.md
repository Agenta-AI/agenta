# Decisions and open questions

The reasoning behind each decision is in [design.md](design.md). This file is the compact log so it
can be updated without editing the design narrative.

## Decision log

| # | Question | Options | Decision | Reason |
| --- | --- | --- | --- | --- |
| D1 | How does the file reach the model? | inline content blocks; file on disk plus a path; both | Both | Inline is the only guaranteed perception path: deterministic at the prompt-build seam, uniform across harnesses, and it survives a replay. The disk copy lets the agent's tools work on the file, and on some harnesses the agent's own read tool adds a second, agent-mediated route to perception (research.md, section 4). The two serve different goals. |
| D2 | Does storing the file in the object store remove the need to send bytes to the model? | yes, fully; no, only from the wire and the saved history | No, only from the wire and the saved history | Storage keeps bytes out of the durable records the runner replays on a cold start, but the model boundary still needs the bytes inline at prompt time, rebuilt per turn by the runner from the stored original. |
| D3 | Where does the unchanging original live? | a subfolder in cwd; the agent-files mount; a dedicated session mount kept out of the sandbox; a future project drive | A dedicated session-scoped attachments mount, kept out of the sandbox | The working directory is last-writer-wins, so an original there could be deleted or overwritten by the agent. Findability needs the original out of the agent's reach, and the mount technology exposes whole prefixes, so out-of-reach means its own mount. |
| D4 | One copy or two? | one copy (perceive and edit the same object); two copies | Two copies: an unchanging original and a disposable working copy | One copy cannot be both safe-to-find and freely-editable. Two copies make both goals true and turn an agent edit into a new, visible output rather than a destroyed original. |
| D5 | How does the system know whether a modality will reach the model? | a single capability flag; the intersection of three layers (protocol transport, adapter fidelity, model modalities) | The three-layer intersection, gated at the composer (courtesy, from a pre-send approximation) and the runner (final authority) | A flag can be advertised while the delivery is lossy or dropped, so one flag is not enough. Tool use over the working copy is separate and works regardless of all three layers. |
| D6 | What happens when the model cannot perceive an attached kind? | refuse the attachment; drop it silently; fail the turn; attach it as a workspace-only file with a visible notice | Attach it as a workspace-only file with a visible notice; the runner fails the turn only on a contract violation (asked to deliver a native block the harness cannot accept) | Attach means two things: show it to the model, and put it in the workspace. The workspace half always works, so refusing or failing would block legitimate tool use. Silent dropping is the current trap. A visible notice keeps it honest. |
| D7 | How is the original kept immutable? | keep it out of the sandbox; also write only through a create-only upload route and never sign the mount; also a read-only credential scope | Keep it out of the sandbox, and write only through the create-only upload route with no signed credentials for the mount; read-only scope is a hardening follow-up | Keeping it out of the sandbox stops the agent, the main threat. Originals enter only through the create-only upload route, and the API refuses overwrite and delete of an original as an explicit check, because `write_file` overwrites silently today. No signed credentials are issued for the mount, because any signed credential is read-write today. A read-only scope is the strongest form and needs a signing change, so it waits. |
| D8 | Is audio in scope? | defer; include | Include as a product goal | Audio stays a goal, and there is no disk-read fallback for it. Native delivery is infeasible today at two independent layers: neither pinned adapter (`claude-agent-acp`, `pi-acp`) advertises ACP audio, and the Anthropic Messages API has no audio input at all (research.md, section 4). The releases are staged: browser dictation now (D14), server-side transcription later (surveyed and deferred, research.md, section 4), the native ACP audio block last. |
| D9 | Can the inline-only version grow into the full one? | it is a different architecture; it grows cleanly with no rework; the model-facing seam is preserved but the rest is system-wide | The model-facing seam is preserved, but adopting durable references later is still a system-wide change | Shipping the inline-only version first avoids a rewrite of the one prompt-builder seam. It does not avoid the rest: front-end persistence, API storage ownership, SDK wire types, runner resolution, the record schema, authorization, and cleanup. So the benefit is narrow and honest, not a free migration. |
| D10 | What does the reference on the wire contain? | raw storage coordinates (mount id, path, client media type); an opaque server-issued id | An opaque server-issued attachment id, with the API owning the storage location and the verified metadata | Raw coordinates let a client forge a reference to another session's file and make the client's media type authoritative even though a client can lie. An opaque id keeps storage private to the API, lets the server verify the media type on upload, and makes the session-binding check natural to express. |
| D11 | What does attaching a file promise in the first release? | image perception only (strict limits, no durability); durable agent input (immutable original, workspace copy, findability, records) | Durable agent input from day one, with workspace-always plus native-when-possible semantics | The product owner decided on 2026-07-31 to build the full reference-based design from the first release; no inline-only version will be built. Durable agent input matches the three outcomes in context.md and avoids shipping a storage-less version that would need rework (D9). |
| D12 | What does a cold replay deliver for historical attachments? | re-deliver inline within a count and byte budget; a textual mention with the real filename and working-copy path, a cold-start sweep that restores missing working copies, inline delivery only for the running turn | Mention-first: the rebuilt conversation carries the mention, the cold start restores every referenced working copy, and inline delivery is reserved for the running turn's references | The harnesses' read tools verifiably deliver images from disk on all three harnesses and PDFs on Claude (research.md, section 4), so a mentioned file is one tool call away. Nothing inline grows with the history, which removes the recurring re-delivery cost and dissolves the budget problem; this decision replaces the former open question on the cold-replay budget numbers. Accepted cost: historical-image perception is agent-discretionary instead of guaranteed. On Pi, documents lose nothing, because inline PDFs never worked there. Accepted corner: only the cold start sweeps, so a warm prose-only turn after the agent deleted a working copy still finds it missing; revisit with evidence. |
| D13 | Do drawer uploads and composer attachments share one pipeline? | route every upload through the attachment pipeline; split by surface | Split by surface, deliberately. A file dragged into the Files drawer (or its folders) uploads directly to that mount at that path, the existing drive-upload flow. The attachment pipeline (attachment resource, immutable original, opaque reference) applies only to files shared through the chat composer, whether typed, pasted, dropped, or picked there. | The two surfaces express two different intents: "put this file there" versus "share this with the agent in the conversation." Routing a drawer drop through attachments would give a plain folder write the wrong semantics: immutability and per-session attachment scoping where the person asked for a file at a path they chose. The drive path already exists and works (PR #5459, merged behind `NEXT_PUBLIC_AGENT_FILE_UPLOADS`). |
| D14 | What does the first release do with speech and audio files? | browser dictation only; transcription through the person's stored keys via litellm; transcription on an Agenta platform key; whisper in the services layer | Browser dictation only. The composer's dictation mode (Web Speech API, `web/oss/src/components/AgentChatSlice/hooks/useVoiceInput.ts`, merged dark in PR #5458) turns live speech into text in the composer while the person talks; no audio file is involved and nothing new is built. A recorded voice message or an uploaded audio file gets no transcription: it follows the D6 workspace-only path (immutable original, working copy, and the visible notice that the model will not hear it), and the agent's tools can still process the file. Server-side transcription is deferred out of the first release: no transcription endpoint, no key resolver, no platform key, no metering. Native ACP audio delivery is the last upgrade. | The recorded-audio limit is structural: the Web Speech API transcribes only a live microphone stream, so the browser cannot transcribe a recorded blob (research.md, section 4). Crossing that line means a server-side service with key resolution and metering, and the decision is to add none of that machinery now. The survey behind the deferred follow-up (litellm call path, prices, who has a usable key) is in research.md, section 4. |

## Settled by evidence

These questions are answered by evidence in the code or by constraints already in place, not by a
product choice, and are recorded here so they are not reopened by accident.

- **Does a document reach the model natively?** Answered by reading the adapter code, not by a live
  test. Neither pinned adapter delivers a document natively today: the Claude adapter drops a blob
  resource entirely, and the Pi adapter renders it as a byte count (see [research.md](research.md),
  section 4). So documents do not arrive natively today. This is no longer an open question; it is a
  Stage 2 blocker (see [plan.md](plan.md), Stage 2).
- **What path convention does the working copy use?** Decided: the id-namespaced visible path
  `cwd/attachments/<attachment_id>/<filename>`, which is discoverable by the agent and collision-proof
  across same-name files ([design.md](design.md), The working-copy path and edited copies).
- **Does the runner read the original through the API or directly from the object store?** Decided:
  through the API download route for the first release, with the session-binding check kept in one
  place. Reading the object store directly with a read-only credential scope is the Stage 3 hardening
  ([design.md](design.md), decision D7).
- **What is the media-type, validation, and limits matrix?** Settled 2026-07-31 as engineering
  defaults; the full matrix is in [design.md](design.md), "The media-type, validation, and limits
  matrix". In brief: the server classifies by inspected magic bytes and stores the verified type
  (declared type never trusted, per D10); rejection happens only for size and unrecognizable bytes,
  never for kind (D6); the per-kind caps mirror the shipped client caps (100 files per turn, 10 MB
  images, 15 MB audio, 10 MB documents, `attachments.ts`, verified 2026-07-31); the compose gateway
  `client_max_body_size` rises from 10 MB to 32 MB
  (`hosting/docker-compose/oss/nginx/nginx.conf`; railway already allows 32 MB) with the upload
  route's per-kind caps as the enforced truth; and an original that exceeds a provider's inline cap
  (for example Anthropic's 10 MB base64 per image, about 7.5 MB raw) is delivered workspace-only
  with the D6 notice, never resized and never a failed turn.
- **What are the retention rules when a session is archived or deleted?** Settled 2026-07-31:
  attachment originals share their session's lifecycle. They are deleted when the session is
  deleted, and kept as long as the session exists, including while it is archived. The attachments
  mount is a session mount, so the existing session-mount teardown already implements this:
  `delete_session_mounts` hard-deletes the mount rows and their object-store prefixes, and
  `archive_session_mounts` soft-archives reversibly without touching the bytes
  (`api/oss/src/core/mounts/service.py`, verified 2026-07-31). An independent expiry while the
  session lives would break the design's own findability promise, because the conversation renders
  by resolving references against originals. The implementation cost is one Stage 3 test asserting
  the attachments mount is included in the existing session teardown. Per-workspace retention
  policies and user-initiated purge of a single original are deferred follow-ups
  ([scope.md](scope.md)).

## Open questions

All the product decisions are taken (D1 through D14). One implementation-time question remains. It
says what is unknown, why it matters, how to settle it, and what it blocks.

1. **How are unused uploads cleaned up (the refinement)?**
   - We do not yet know when to move from a time-to-live sweep to reference counting against the
     conversation records.
   - This matters because a file uploaded but never sent leaves a stored object, and the sweep needs
     a marker telling it which uploads are still unused. Reference counting against the records is
     more precise than a marker plus an age cutoff.
   - The starting answer is that a time-to-live sweep ships first, in Stage 1, over uploads that were
     never claimed. Nothing is marked by being downloaded: the runner calls the claim operation once
     it has validated the current turn, and only a claimed upload is durable. Reference counting is
     added only after records reliably carry references, because counting needs the record schema to
     hold the reference.
   - This blocks the cleanup refinement in Stage 3.
