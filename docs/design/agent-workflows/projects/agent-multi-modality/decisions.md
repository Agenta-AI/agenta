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
| D8 | Is audio in scope? | defer; include | Include as a product goal | Audio stays a goal, and there is no disk-read fallback for it. Native delivery is infeasible today at two independent layers: neither pinned adapter (`claude-agent-acp`, `pi-acp`) advertises ACP audio, and the Anthropic Messages API has no audio input at all (research.md, section 4). The first audio release therefore delivers audio through transcription we own (D14); the native ACP audio block is the later upgrade. |
| D9 | Can the inline-only version grow into the full one? | it is a different architecture; it grows cleanly with no rework; the model-facing seam is preserved but the rest is system-wide | The model-facing seam is preserved, but adopting durable references later is still a system-wide change | Shipping the inline-only version first avoids a rewrite of the one prompt-builder seam. It does not avoid the rest: front-end persistence, API storage ownership, SDK wire types, runner resolution, the record schema, authorization, and cleanup. So the benefit is narrow and honest, not a free migration. |
| D10 | What does the reference on the wire contain? | raw storage coordinates (mount id, path, client media type); an opaque server-issued id | An opaque server-issued attachment id, with the API owning the storage location and the verified metadata | Raw coordinates let a client forge a reference to another session's file and make the client's media type authoritative even though a client can lie. An opaque id keeps storage private to the API, lets the server verify the media type on upload, and makes the session-binding check natural to express. |
| D11 | What does attaching a file promise in the first release? | image perception only (strict limits, no durability); durable agent input (immutable original, workspace copy, findability, records) | Durable agent input from day one, with workspace-always plus native-when-possible semantics | The product owner decided on 2026-07-31 to build the full reference-based design from the first release; no inline-only version will be built. Durable agent input matches the three outcomes in context.md and avoids shipping a storage-less version that would need rework (D9). |
| D12 | What does a cold replay deliver for historical attachments? | re-deliver inline within a count and byte budget; a textual mention with the real filename and working-copy path, a cold-start sweep that restores missing working copies, inline delivery only for the running turn | Mention-first: the rebuilt conversation carries the mention, the cold start restores every referenced working copy, and inline delivery is reserved for the running turn's references | The harnesses' read tools verifiably deliver images from disk on all three harnesses and PDFs on Claude (research.md, section 4), so a mentioned file is one tool call away. Nothing inline grows with the history, which removes the recurring re-delivery cost and dissolves the budget problem; this decision replaces the former open question on the cold-replay budget numbers. Accepted cost: historical-image perception is agent-discretionary instead of guaranteed. On Pi, documents lose nothing, because inline PDFs never worked there. Accepted corner: only the cold start sweeps, so a warm prose-only turn after the agent deleted a working copy still finds it missing; revisit with evidence. |
| D13 | Do drawer uploads and composer attachments share one pipeline? | route every upload through the attachment pipeline; split by surface | Split by surface, deliberately. A file dragged into the Files drawer (or its folders) uploads directly to that mount at that path, the existing drive-upload flow. The attachment pipeline (attachment resource, immutable original, opaque reference) applies only to files shared through the chat composer, whether typed, pasted, dropped, or picked there. | The two surfaces express two different intents: "put this file there" versus "share this with the agent in the conversation." Routing a drawer drop through attachments would give a plain folder write the wrong semantics: immutability and per-session attachment scoping where the person asked for a file at a path they chose. The drive path already exists and works (PR #5459, merged behind `NEXT_PUBLIC_AGENT_FILE_UPLOADS`). |
| D14 | How does audio reach the model before adapters support it? | wait for native ACP audio; transcription we own | Transcription we own, as the interim path. A voice recording uploads as a normal attachment (immutable original, workspace copy, like any file), we transcribe it ourselves, and the transcript text is what reaches the model inline. Native ACP audio delivery becomes a later upgrade if adapters ever support it. | Native audio is infeasible today at two independent layers: no adapter advertises ACP audio, and the Anthropic Messages API has no audio input at all (research.md, section 4). Transcription needs nothing from the adapters, keeps the recording findable like any attachment, and unblocks the already-built voice UI (PR #5458). The exact transcription trigger (on-upload versus on-click) and the transcription service are open implementation questions. |

## Settled by evidence

Three questions that shaped the design are answered by evidence in the code, and are recorded here so
they are not reopened by accident.

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

## Open questions

All the product decisions are taken (D1 through D14). What remains are implementation-time
questions. Each one says what is unknown, why it matters, how to settle it, and what it blocks.

1. **Which service transcribes audio, and when does transcription run?**
   - D14 decides that the first audio release delivers a transcript we produce ourselves, but not
     which transcription service produces it or when it runs (on upload, or on demand when the clip
     is first sent or played).
   - This matters because the trigger sets the latency the person sees at send time and the cost of
     transcribing clips that are never sent, and the service sets quality, language coverage, and
     price.
   - To settle it, compare the candidate services and the two triggers during the audio
     implementation, against the voice UI that already exists (PR #5458).
   - This blocks the audio work in Stage 2.

2. **When are the old capability names removed across the independently deployed components?**
   - We do not yet know the timing of dropping the `fileAttachments` and `file_attachments` aliases
     once the front end, API, SDK, and runner all speak the new names.
   - This matters because removing an alias before every component is updated breaks the versions in
     between, and the four components deploy independently.
   - To settle it, remove the aliases only after every component's deployed version emits and accepts
     the new names, confirmed per component.
   - This blocks the cleanup step of the alias rollout in Stage 2.

3. **What are the retention rules when a session is archived or deleted?**
   - We do not yet know what happens to a session's attachment originals when the session is archived
     or deleted, and how long they are kept.
   - This matters because attachments are durable originals, so their lifecycle has to be defined
     rather than left implicit, both for storage cost and for a person's expectation that a shared file
     stays findable.
   - To settle it, define retention against the session lifecycle and any tenant data-retention
     policy.
   - This blocks the findability and cleanup work in Stage 3.

4. **What is the exact media-type, validation, and limits matrix?**
   - We do not yet know how the declared media type relates to the type the server inspects from the
     bytes when they disagree, which formats are allowed per kind (image, audio, document), and what
     the server-side size and count limits are per kind.
   - This matters because the server verifies the media type rather than trusting the client (D10), so
     the rules for a mismatch and the allowed-format list have to be explicit to be enforceable. It
     matters for limits because enforcement today is client-side only: the merged composer limits
     (`DEFAULT_ATTACHMENT_LIMITS` in `web/oss/src/components/AgentChatSlice/assets/attachments.ts`,
     verified 2026-07-31) allow 5 files per message, 10 MB per image, 15 MB per audio clip, and 10 MB
     per document, and a client can bypass them. The server-side check belongs to the new upload
     route. The route must also reckon with the infrastructure: the docker-compose gateway caps the
     API request body at 10 MB (`client_max_body_size` in
     `hosting/docker-compose/oss/nginx/nginx.conf`, verified 2026-07-31), which the 15 MB client-side
     audio limit already exceeds, so either the gateway cap rises or the client caps come down.
   - To settle it, write the matrix of declared type versus the type inspected from the bytes, the
     allowed formats per kind, and the per-kind size and count limits including the gateway cap, and
     enforce it in the upload route.
   - This blocks the server-side validation in Stage 1.

5. **How are unused uploads cleaned up (the refinement)?**
   - We do not yet know when to move from a time-to-live sweep to reference counting against the
     conversation records.
   - This matters because a file uploaded but never sent leaves a stored object, and reference
     counting is more precise than a blind sweep.
   - The starting answer is that a time-to-live sweep ships first, in Stage 1. Reference counting is
     added only after records reliably carry references, because counting needs the record schema to
     hold the reference.
   - This blocks the cleanup refinement in Stage 3.
