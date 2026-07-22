# Decisions and open questions

The reasoning behind each decision is in [design.md](design.md). This file is the compact log so it
can be updated without editing the design narrative.

## Decision log

| # | Question | Options | Decision | Reason |
| --- | --- | --- | --- | --- |
| D1 | How does the file reach the model? | inline content blocks; file on disk plus a path; both | Both | Inline gives real perception (required by ACP; a disk file is not reliably read as vision). The disk copy lets the agent's tools work on the file. The two serve different goals. |
| D2 | Does storing the file in the object store remove the need to send bytes to the model? | yes, fully; no, only from the wire and the saved history | No, only from the wire and the saved history | Storage removes bytes from the resent history, but the model boundary still needs the bytes inline at prompt time, rebuilt per turn by the runner from the stored original. |
| D3 | Where does the unchanging original live? | a subfolder in cwd; the agent-files mount; a dedicated session mount kept out of the sandbox; a future project drive | A dedicated session-scoped attachments mount, kept out of the sandbox | The working directory is last-writer-wins, so an original there could be deleted or overwritten by the agent. Findability needs the original out of the agent's reach, and the mount technology exposes whole prefixes, so out-of-reach means its own mount. |
| D4 | One copy or two? | one copy (perceive and edit the same object); two copies | Two copies: an unchanging original and a disposable working copy | One copy cannot be both safe-to-find and freely-editable. Two copies make both goals true and turn an agent edit into a new, visible output rather than a destroyed original. |
| D5 | How does the system know whether a modality will reach the model? | a single capability flag; the intersection of three layers (protocol transport, adapter fidelity, model modalities) | The three-layer intersection, gated at the composer (courtesy, from a pre-send approximation) and the runner (final authority) | A flag can be advertised while the delivery is lossy or dropped, so one flag is not enough. Tool use over the working copy is separate and works regardless of all three layers. |
| D6 | What happens when the model cannot perceive an attached kind? | refuse the attachment; drop it silently; fail the turn; attach it as a workspace-only file with a visible notice | Attach it as a workspace-only file with a visible notice; the runner fails the turn only on a contract violation (asked to deliver a native block the harness cannot accept) | Attach means two things: show it to the model, and put it in the workspace. The workspace half always works, so refusing or failing would block legitimate tool use. Silent dropping is the current trap. A visible notice keeps it honest. |
| D7 | How is the original kept immutable? | keep it out of the sandbox; also write only through a create-only upload route and never sign the mount; also a read-only credential scope | Keep it out of the sandbox, and write only through the create-only upload route with no signed credentials for the mount; read-only scope is a hardening follow-up | Keeping it out of the sandbox stops the agent, the main threat. Originals enter only through the create-only upload route, and the API refuses overwrite and delete of an original as an explicit check, because `write_file` overwrites silently today. No signed credentials are issued for the mount, because any signed credential is read-write today. A read-only scope is the strongest form and needs a signing change, so it waits. |
| D8 | Is audio in scope? | defer; include | Include as a product goal, but blocked on adapter work | Audio stays a goal, and there is no disk-read fallback for it, so it forces a real inline audio block. Neither pinned adapter (`claude-agent-acp`, `pi-acp`) advertises native audio today, so the audio stage cannot ship against the current pins and is blocked on adapter or harness work. |
| D9 | Can the inline-only version grow into the full one? | it is a different architecture; it grows cleanly with no rework; the model-facing seam is preserved but the rest is system-wide | The model-facing seam is preserved, but adopting durable references later is still a system-wide change | Shipping the inline-only version first avoids a rewrite of the one prompt-builder seam. It does not avoid the rest: front-end persistence, API storage ownership, SDK wire types, runner resolution, the record schema, authorization, and cleanup. So the benefit is narrow and honest, not a free migration. |
| D10 | What does the reference on the wire contain? | raw storage coordinates (mount id, path, client media type); an opaque server-issued id | An opaque server-issued attachment id, with the API owning the storage location and the verified metadata | Raw coordinates let a client forge a reference to another session's file and make the client's media type authoritative even though a client can lie. An opaque id keeps storage private to the API, lets the server verify the media type on upload, and makes the session-binding check natural to express. |
| D11 (open) | What does attaching a file promise in the first release? | image perception only (strict limits, no durability); durable agent input (immutable original, workspace copy, findability, records) | OPEN. Recommendation: durable agent input, with workspace-always plus native-when-possible semantics | This is the product owner's call, not an engineering one. The engineering design supports either. The recommendation is durable agent input because it matches the three outcomes in context.md and avoids shipping a storage-less version that would need rework. Marked open until the product owner decides. |

## Settled by evidence

Three questions that shaped the design are answered by evidence in the code, and are recorded here so
they are not reopened by accident.

- **Does a document reach the model natively?** Answered by reading the adapter code, not by a live
  test. Neither pinned adapter delivers a document natively today: the Claude adapter drops a blob
  resource entirely, and the Pi adapter renders it as a byte count (see [research.md](research.md),
  section 4). So documents do not arrive natively today. This is no longer an open question; it is a
  Stage 2 blocker (see open question 2 for audio and [plan.md](plan.md), Stage 2).
- **What path convention does the working copy use?** Decided: the id-namespaced visible path
  `cwd/attachments/<attachment_id>/<filename>`, which is discoverable by the agent and collision-proof
  across same-name files ([design.md](design.md), The working-copy path and edited copies).
- **Does the runner read the original through the API or directly from the object store?** Decided:
  through the API download route for the first release, with the session-binding check kept in one
  place. Reading the object store directly with a read-only credential scope is the Stage 3 hardening
  ([design.md](design.md), decision D7).

## Open questions

Each one says what is unknown, why it matters, how to settle it, and what it blocks.

1. **What does attaching a file promise in the first release? (D11, the product owner's decision.)**
   - We do not yet know whether the first release promises image perception only, or durable agent
     input with the immutable original, the workspace copy, findability, and records.
   - This matters because it sets the scope and the promise of the whole first release, and it is a
     product call rather than an engineering one.
   - To settle it, the product owner decides on the PR. The design recommends durable agent input with
     workspace-always plus native-when-possible semantics (D11).
   - This blocks the shape of Stage 1.

2. **How is native audio delivered at all?**
   - We do not yet know whether audio waits on adapter work (an adapter that advertises the audio
     capability and delivers an ACP audio block), on moving to a different harness that supports it, or
     is deferred outright.
   - This matters because neither pinned adapter supports native audio today, so the audio stage
     cannot ship against the current pins.
   - To settle it, track adapter releases for audio support, or decide to defer audio until one
     exists.
   - This blocks the audio part of Stage 2.

3. **What are the cold-replay budget numbers?**
   - We do not yet know how many historical attachments, and within what size budget, may be
     re-delivered natively on a cold start before falling back to a working copy plus a textual
     placeholder.
   - This matters because re-sending every past attachment natively on a long conversation would
     exceed the provider's per-request size and block limits (see [research.md](research.md), section
     3).
   - To settle it, pick a bound in implementation against real provider limits and measure a long
     replayed conversation against it.
   - This blocks the cold-replay policy in Stage 1.

4. **When are the old capability names removed across the independently deployed components?**
   - We do not yet know the timing of dropping the `fileAttachments` and `file_attachments` aliases
     once the front end, API, SDK, and runner all speak the new names.
   - This matters because removing an alias before every component is updated breaks the versions in
     between, and the four components deploy independently.
   - To settle it, remove the aliases only after every component's deployed version emits and accepts
     the new names, confirmed per component.
   - This blocks the cleanup step of the alias rollout in Stage 2.

5. **What are the retention rules when a session is archived or deleted?**
   - We do not yet know what happens to a session's attachment originals when the session is archived
     or deleted, and how long they are kept.
   - This matters because attachments are durable originals, so their lifecycle has to be defined
     rather than left implicit, both for storage cost and for a person's expectation that a shared file
     stays findable.
   - To settle it, define retention against the session lifecycle and any tenant data-retention
     policy.
   - This blocks the findability and cleanup work in Stage 3.

6. **What is the exact media-type and validation matrix?**
   - We do not yet know how the declared media type relates to the type the server inspects from the
     bytes when they disagree, and which formats are allowed per kind (image, audio, document).
   - This matters because the server verifies the media type rather than trusting the client (D10), so
     the rules for a mismatch and the allowed-format list have to be explicit to be enforceable.
   - To settle it, write the matrix of declared type versus the type inspected from the bytes and the
     allowed formats per kind, and enforce it in the upload route.
   - This blocks the server-side validation in Stage 1.

7. **How are unused uploads cleaned up (the refinement)?**
   - We do not yet know when to move from a time-to-live sweep to reference counting against the
     conversation records.
   - This matters because a file uploaded but never sent leaves a stored object, and reference
     counting is more precise than a blind sweep.
   - The starting answer is that a time-to-live sweep ships first, in Stage 1. Reference counting is
     added only after records reliably carry references, because counting needs the record schema to
     hold the reference.
   - This blocks the cleanup refinement in Stage 3.
