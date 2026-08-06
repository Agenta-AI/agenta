# Research

This file collects the findings the design rests on. It is meant to be read top to bottom. Each
section answers one question. Every claim links to a file and line in our code, or to an outside
source. Line numbers drift as files change, so treat them as a starting point and confirm the
surrounding function name.

Sections:

1. Section 1 explains where the file is lost today and the side effects it causes.
2. Section 2 describes the mounts system: what it is, every endpoint, who may call each one, and how
   the file panel uses them today.
3. Section 3 covers the kinds of files and how models handle them: which kinds a model perceives
   natively, which are just files an agent reads with tools, and the size limits per provider.
4. Section 4 explains how ACP carries content and what each harness does with each content type.
5. Section 5 compares two ways to deliver a file to the model.
6. Section 6 surveys how other tools handle attachments: Zed, opencode, and others.
7. Section 7 covers records and replay: what exists and the direction for the runner to rebuild
   context.
8. Section 8 covers assistant-produced files: what is declared and what is missing.
9. Section 9 explains the capability flags: where they came from and why they were never used.
10. Section 10 covers the front-end adapter and its current limits.

---

## 1. Current state of the code

The attachment path is wired from the chat box all the way to the runner. It breaks at the last
step before the harness.

| Step | Where | Carries the file? |
| --- | --- | --- |
| Chat box picks, pastes, drops, previews the file | `web/oss/src/components/AgentChatSlice/assets/files.ts:20` (`fileToPart` reads the file into a `data:` URL) | Yes, as a base64 `data:` URL in an AI SDK `file` part |
| Request body carries the message parts | `web/packages/agenta-playground/src/state/execution/agentRequest.ts` (history assembled from message parts) | Yes |
| Our SDK parses the part into a content block | `sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:97` (`_part_to_blocks`, the `file` case) | Yes, into a `ContentBlock` of type `image` or `resource` |
| Our SDK writes the wire payload | `sdks/python/agenta/sdk/agents/utils/wire.py` (`ContentBlock.to_wire`) | Yes, base64 intact |
| Runner receives the request | `services/runner/src/server.ts` | Yes, intact |
| **Runner hands the turn to the harness** | `services/runner/src/engines/sandbox_agent/run-turn.ts:742` | **No. It sends `[{ type: "text", text: turnText }]` only.** |

The single real call that sends a turn to the harness is `env.session.prompt(...)` at
`run-turn.ts:742`. It is hard-coded to one text block. The text it sends comes from
`messageText()` at `protocol.ts:573`, which keeps only blocks whose `type` is `"text"` and joins
them. Everything that is not text is discarded there.

Three concrete failures follow from this:

1. **Image and text together.** The model receives only the text. When the conversation is later
   rebuilt from the durable records on a cold start, the image is absent entirely, because the
   records store only the text (see section 7). A history that still carries an image block (for
   example a resume, where the front end sends the full history) is flattened to the literal
   string `"[image]"` (`transcript.ts`).
2. **Image with no text.** The turn is rejected. `resolvePromptText()` (`protocol.ts:585`) returns
   an empty string, and the run fails with "No user message to send" from `run-plan.ts`.
3. **No warning to the person.** The attach button, the attachment preview, and the drive-upload
   surfaces are behind the `NEXT_PUBLIC_AGENT_FILE_UPLOADS` flag, off by default
   (`web/oss/src/components/AgentChatSlice/assets/constants.ts`, verified 2026-07-31), but pasting
   or dragging a file into the composer predates the flag, is not gated, and still reaches the dead
   end. The person is never told the file will be ignored.

### Side effects that a reference-based design removes

- **Resending the whole conversation every turn (fixed since the session-storage rework).** The
  front end used to resend the full message history on each turn, so a five megabyte image became
  about seven megabytes of base64 re-uploaded on every later turn, a cost that could grow with the
  square of the conversation length in the worst case. The session-storage rework (PR #5560, merged 2026-07-30,
  on by default) removed this: the front end sends only the trailing user message
  (`NEXT_PUBLIC_SESSIONS_LAST_MESSAGE_ONLY`, read in `agentRequest.ts`), the runner persists every
  turn as durable records (`AGENTA_RECORDS_DURABLE`, `services/runner/src/sessions/persist.ts`),
  and on a cold start it rebuilds the conversation from those records
  (`AGENTA_SESSIONS_RECONSTRUCT`,
  `services/runner/src/engines/sandbox_agent/reconstruct-history.ts`). What remains is the
  attaching turn itself: its bytes still ride that one message as base64.
- **Filling the browser's local storage.** Saved messages hold the base64 inline
  (`web/oss/src/components/AgentChatSlice/state/sessions.ts:31`, which notes "a conversation with
  large files can approach the localStorage quota"). When the roughly five megabyte browser quota
  is exceeded, `writeMessagesWithQuotaGuard` (`sessions.ts:409`) drops other sessions' saved
  transcripts to make room.
- **Bloating the traces.** The Python agent span keeps the messages on purpose and there is no
  length cap on exported span attributes, so a base64 image lands verbatim in a trace.

Once the saved messages and the traces carry a small reference instead of the bytes, the remaining
costs go away too, because the bytes are stored once in the object store and never travel with the
messages again.

---

## 2. The mounts system

### What a mount is

A mount is one named storage area in an S3 object store. Each mount has its own set of object
keys under a prefix and can hand out short-lived, prefix-scoped credentials so a client can read
and write its files directly. The code lives in `api/oss/src/core/mounts/service.py` (the service),
`api/oss/src/apis/fastapi/mounts/router.py` (the general routes), and
`api/oss/src/apis/fastapi/sessions/router.py` (the session-scoped routes, class
`SessionMountsRouter` near line 863).

The object key layout is
`[<namespace>/]mounts/<project_id>/<mount_id>/<path>` (`service.py:358`, `_storage_key`). The
`<project_id>` segment is the tenant partition of the key. **It is not a "project mount."** There
is no project-scoped mount kind in the system today. Every mount in practice carries a session
scope or an agent scope. In `MountQuery`
(`api/oss/src/core/mounts/dtos.py:25`) both `session_id` and `agent_id` are optional, so the type
itself does not forbid a mount with neither scope. The current code never creates one, so the
accurate claim is that no project-scoped mount kind exists in practice, not that the type makes one
impossible. So in a
storage key like `mounts/<project_id>/<attachments_mount_id>/photo.png`, the first segment only
says which tenant owns the bytes; the mount itself is still session-scoped.

There are three kinds of mount today:

- **A session `cwd` mount.** Backs the agent's working directory for one session. Created on first
  use, keyed on the session id (`get_or_create_session_cwd`, `service.py:489`). Mounted into the
  sandbox so the agent sees it as its working folder.
- **Extra named session mounts.** A session can have more than one mount, each with its own name
  and its own storage prefix (`get_or_create_session_mount(session_id, name=...)`, `service.py:405`).
  The comment there says any name other than `cwd` is "an additional session-scoped mount sharing
  the same shape with its own prefix." This existing function is what the design uses to create a
  separate attachments mount.
- **An agent mount.** Durable across all sessions of one agent. This is the `agent-files` folder
  the agent sees. It exists because its lifecycle is different (it outlives the session). It is
  mounted into the sandbox beside `cwd` and linked in as `agent-files/`
  (`services/runner/src/engines/sandbox_agent/agent-mount.ts:16`, `AGENT_FILES_LINK_NAME`).

The `cwd` mount is the agent's writable working folder. Its own README, written for the agent,
says: "Concurrent runs share this folder, so the last writer wins for each file"
(`agent-mount.ts:23`). In other words, the agent can overwrite or delete anything in `cwd`. That
fact drives a key design choice (see [design.md](design.md), the decision on where originals live).

### Every mounts endpoint, who may call it, and what it does

All of these sit behind the API's normal authentication. A caller is a person (through the web
app, carrying a JWT) or a program (carrying an API key), and either resolves to a user id and a
project id in `request.state`. On top of that, each route checks a role-based permission with
`check_action_access`. The runner is not a special caller: when it needs storage credentials, it
calls the sign endpoint with the same authorization the invocation carried.

General mounts routes, registered in `MountsRouter.__init__` (`router.py:120`):

| Route | Method | Permission | Arguments | What it does |
| --- | --- | --- | --- | --- |
| `/mounts/` | POST | `EDIT_MOUNTS` | mount body | Create a mount. |
| `/mounts/query` | POST | `VIEW_MOUNTS` | filters (`session_id`, `agent_id`) | List mounts. |
| `/mounts/{id}` | GET | `VIEW_MOUNTS` | mount id | Fetch one mount. |
| `/mounts/{id}` | PUT | `EDIT_MOUNTS` | mount body | Edit a mount. |
| `/mounts/{id}/sign` | POST | `USE_MOUNTS` | mount id | Mint short-lived S3 credentials scoped to this mount's prefix. |
| `/mounts/agents/sign` | POST | `USE_MOUNTS` | `artifact_id`, `name` | Get-or-create the agent mount and sign it. |
| `/mounts/agents/query` | POST | `VIEW_MOUNTS` | JSON body with `artifact_id`, `name` | Fetch the agent mount without creating it. The arguments arrive in a JSON body, not as query parameters. |
| `/mounts/{id}/archive` / `/unarchive` | POST | `EDIT_MOUNTS` | mount id | Soft archive or restore. |
| `/mounts/{id}/files` | GET | `VIEW_MOUNTS` | `path`, `read`, `order`, `limit`, `depth`, `git_aware`, `include_gitignored`, `with_counts` | List files or read one file's text. `with_counts` adds child counts to the listing. |
| `/mounts/{id}/files` | PUT | `EDIT_MOUNTS` | `path`, raw body | Write one file from a raw body. |
| `/mounts/{id}/files` | DELETE | `EDIT_MOUNTS` | `path` | Delete a file or a folder. |
| `/mounts/{id}/files/folder` | POST | `EDIT_MOUNTS` | `path` | Create an empty folder marker. |
| `/mounts/{id}/files/upload` | POST | `EDIT_MOUNTS` | multipart `file`, `path` | Upload a file through the API. |
| `/mounts/{id}/files/download` | GET | `VIEW_MOUNTS` | `path` | Download exact bytes as a binary response. |
| `/mounts/files/export` | POST | `VIEW_MOUNTS` | list of mounts | Stream a zip of many files ("download all"). |

Session-scoped routes, registered in `SessionMountsRouter.__init__` (`sessions/router.py:863`).
These require the session permission **and** the mounts permission together (`_check` loops over
both, `sessions/router.py:925`):

| Route | Method | Permissions | Arguments | What it does |
| --- | --- | --- | --- | --- |
| `/sessions/mounts/` | GET | `VIEW_SESSIONS` + `VIEW_MOUNTS` | `session_id` | List this session's mounts. |
| `/sessions/mounts/query` | POST | `VIEW_SESSIONS` + `VIEW_MOUNTS` | `session_id` | List with a body query. |
| `/sessions/mounts/sign` | POST | `RUN_SESSIONS` + `USE_MOUNTS` | `session_id`, `name` (default `cwd`) | Get-or-create the named session mount and sign it. |
| `/sessions/mounts/{id}/files/upload` | POST | `EDIT_SESSIONS` + `EDIT_MOUNTS` | multipart `file`, `path` | Upload a file into a session mount through the API. |
| `/sessions/mounts/{id}/files/download` | GET | `VIEW_SESSIONS` + `VIEW_MOUNTS` | `path` | Download exact bytes. |

There is **no move or rename endpoint.** Moving a file is done by writing to the new path and
deleting the old one. Renaming works the same way.

### Two ways bytes get in and out of a mount

There are two separate mechanisms, and the difference matters for enforcing that a file cannot be
changed.

- **Through the API.** The upload, write, download, and delete routes read or write bytes
  server-side. Each one enforces its role permission. A person who has `VIEW` but not `EDIT`
  cannot write.
- **Directly against S3 with signed credentials.** The sign endpoints hand out short-lived S3
  credentials scoped to the mount's prefix (`sign_mount_credentials`, `service.py:688`). The holder
  can then read and write objects under that prefix directly, without going back through the API.
  This is how the runner mounts a folder into the sandbox: it signs the `cwd` mount, and geesefs
  uses those credentials to present the mount as a writable directory.

Two consequences for this project:

1. **The runner can read a mount's bytes without mounting it into the sandbox.** The signed
   credentials are ordinary S3 credentials. The runner can do a plain object GET with them. It does
   not have to make the mount appear as a folder for the agent. Note that for the attachments mount
   the design does not use this path at first: because any signed credential is read-write (below),
   decision D7 in [design.md](design.md) issues no signed credentials for that mount at all, and the
   runner reads originals through the API download route; the direct read waits for the read-only
   credential scope in Stage 3.
2. **Server-side "cannot be changed" is achievable.** If a mount's bytes only ever enter through
   the upload API route, and the system never hands out write-capable signed credentials for that
   mount, then nothing but a deliberate API write can change it. That is what makes an attachment
   original immutable in fact, not just by convention. Today `sign_mount_credentials`
   does not offer a read-only variant, so a read-only scope would be a small addition to the
   short-lived storage credentials (STS) signing call. See the hardening step in [plan.md](plan.md),
   Stage 3.

### The write path, precisely

Three facts about how a write actually happens today shape the design, so they are stated exactly.

- **A signed credential is read-write.** `sign_mount_credentials` (`service.py:688`) has no
  read-only variant, so any credential it issues grants write access to the whole mount prefix.
  This matters because it means immutability cannot rest on signed credentials. As long as the
  system signs a mount at all, the holder of that signature can write it. Immutability has to come
  from not signing the mount and only writing it through the permission-checked upload route.
- **The upload route buffers the whole file in memory.** The API upload helper reads the entire
  file into memory before writing it (`api/oss/src/apis/fastapi/mounts/utils.py:45`). This matters
  because a large attachment would hold its full size in the API process. A streaming write path is
  a later addition once large files are in play.
- **`write_file` overwrites silently.** `write_file` (`service.py:1297`) replaces any object
  already at the same path without a check or an error. This matters because "the original is
  create-only" cannot be assumed from the storage layer. The API has to enforce create-only
  semantics itself, by refusing a write to a path that already holds an attachment original.

### How the Files drawer uses these today

The Files drawer is the `DriveExplorer` component (`web/oss/src/components/Drives/DriveExplorer.tsx`).
It shows a session's files as one tree, folding the `cwd` mount and the `agent-files` mount
together. It tags each top-level node by where it came from and shows the origin label only when
the tree mixes origins (`driveHasMixedOrigins` in `ContextRail.tsx`). For file management it calls
the same mount routes above: list to show the tree, upload to add a file, delete to remove one,
and write to save an edit. A "Shared by you" origin for attachments is a new third origin over
this existing tagging, not a new kind of panel.

The service already hides runner-internal paths and dotfiles from the listings
(`_is_internal_mount_path` at `service.py:154`, `_is_hidden_path` at `service.py:190`), so an
internal attachments area would not clutter the normal view.

### Responsibilities across a message-attachment flow

Reading the endpoints above against the three flows that would use them:

- **Managing files in the drawer** (upload, edit, delete, move). The front end owns this. It calls
  the upload, write, delete, and list routes directly. The API enforces permissions and writes the
  bytes. This flow exists today for the `cwd` and agent mounts.
- **Attaching a file to a message.** The front end uploads the file once (to an attachments mount)
  and then sends only a reference on the wire. The API stores the bytes and later serves them to
  the runner. The front end owns the upload and the reference; the API owns storage; the runner
  owns turning the reference into model content.
- **Materializing a working copy for the agent.** The runner owns this. It reads the original from
  the mount and writes a copy into the agent's `cwd` so the agent's tools can open it.

---

## 3. Kinds of files and how models handle them

This is the section that answers "which files are special and which are just files." The key idea:
a model has a small set of input types it perceives directly through its own encoder, and
everything else is just bytes that the agent must open with a tool.

### Native modalities: the model perceives them directly

For these, the bytes must be delivered to the model in a specific content slot. The model has a
built-in path that turns them into something it understands (an image encoder, an audio encoder, a
document parser). That slot is reached through message content, which includes a tool result: a
harness's own read tool can fill it for some kinds when the agent calls it, with coverage that
differs per harness (section 4). A tool that returns only text never reaches this path.

- **Images** (PNG, JPEG, GIF, WebP). Perceived by Claude, the GPT-4o and GPT-5 family, and Gemini.
- **Audio** (for example WAV, MP3). Perceived natively by some models (Gemini, and the GPT audio
  models). There is no reliable way to make a model "hear" audio by having the agent read the file,
  so audio must be delivered as a native audio input.
- **PDF and other documents as a document input.** Claude accepts a PDF as a document content block
  and reads both its text and its page images. This is a native path distinct from plain text.
- **Video.** Gemini perceives video natively. Claude and the current GPT chat models do not. Video
  is out of scope for this project (see [scope.md](scope.md)).

"Document" is not a modality of its own. Whether a PDF, a CSV, or a spreadsheet is perceived
natively depends on three things at once: the specific model, the harness adapter that hands the
bytes to that model, and the exact format. So document support is a per-format, per-adapter,
per-model matrix, not a single flag you can turn on. Section 4 shows how far apart the two adapters
we run actually are on this point.

### Everything else: files an agent reads with tools

For these, there is no special model path. The right handling is to place the file on the agent's
working directory and let the agent's tools open it, possibly after converting it.

- **Plain text, source code, CSV, JSON, Markdown.** The agent reads them with its file tools. Small
  text can also be inlined directly into the prompt as text, which every harness supports.
- **Office documents** (Excel, Word). The agent converts them first (for example with a library
  like openpyxl for a spreadsheet) and then reads the result. The raw binary is not a native model
  input for Claude or GPT.
- **Archives** (zip). The agent extracts them and works on the contents.
- **CAD and other binary formats, and folders.** The agent runs whatever tool understands them.
  These are never native model inputs.
- **Very large files of any kind.** Even a native modality has size limits (below). Past those, a
  file is handled as bytes on disk, not as a native input.

### An important subtlety: a non-vision model can still use an image

An agent whose model cannot see images is not useless with an image. Two separate things are
going on:

1. **Model perception.** Whether the model itself sees the picture. This needs the native image
   path and a vision-capable model.
2. **Tool use over the file.** Whether the agent can run a program on the image bytes, for example
   to resize it, read its metadata, or feed it to an image library. This needs only the file on
   disk. It works even when the model cannot see the image.

So the file should be placed on disk for the agent regardless of whether the model can perceive it,
and the native delivery to the model should happen only when the model supports that modality. This
is exactly the "two outcomes at once" goal from [context.md](context.md).

### Provider limits (verified 2026-07-31; re-verify before relying on them)

From Anthropic's vision and PDF documentation:

- **Whole request.** The Messages API caps a request at 32 megabytes on standard endpoints.
  [Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).
- **Images.** 10 megabytes per image, measured on the base64-encoded data, on the Claude API
  directly (5 megabytes base64 on Amazon Bedrock and Google Cloud). Maximum dimensions 8000x8000
  pixels, with a stricter limit near 2000 pixels per side when a request carries more than 20
  images. 100 images per request on 200k-context models, 600 otherwise. Formats: JPEG, PNG, GIF,
  WebP. [Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).
- **PDF documents.** 32 megabytes maximum request size; 600 pages per request, dropping to 100
  pages when the request's context window is under 1M tokens; standard unencrypted PDF.
  [Anthropic PDF support docs](https://platform.claude.com/docs/en/build-with-claude/pdf-support).

OpenAI's vision input allows 512 megabytes of total payload and 1500 image inputs per request,
with no documented per-image cap (formats: PNG, JPEG, WebP, non-animated GIF).
[OpenAI images and vision guide](https://developers.openai.com/api/docs/guides/images-vision).

Gemini perceives images, audio, and video natively. Inline data shares a 20 megabyte total request
budget, larger files go through its Files API, and a request can carry up to 3,600 images
(formats: PNG, JPEG, WebP, HEIC, HEIF).
[Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding),
[audio understanding](https://ai.google.dev/gemini-api/docs/audio),
[video understanding](https://ai.google.dev/gemini-api/docs/video-understanding).

The important design takeaway is not the exact number, which changes, but the shape: there are hard
per-request and per-file limits, they differ by provider, and our front-end limits should be
derived from the selected model's real limits rather than from the transport-sized static defaults
we have today (see section 10). The settled server-side matrix these numbers feed is in
[design.md](design.md), "The media-type, validation, and limits matrix".

---

## 4. How ACP carries content, and what each harness does with it

### The ACP content model

ACP is the Agent Client Protocol, an external standard published by Zed Industries. The runner
speaks it to the harness through two adapter packages it pins in `services/runner/package.json`:
`@agentclientprotocol/claude-agent-acp` at version `0.58.1` for the Claude harness
(`services/runner/package.json:23`), and `pi-acp` at version `0.0.29` for the Pi harness
(`services/runner/package.json:35`). Both pins verified against the file on 2026-07-31. A third
adapter, `@agentclientprotocol/codex-acp` at version `1.1.7`, arrives with the Codex harness in
PR #5509 (branch `feat/codex-harness`) and is covered below alongside the two pinned ones. The
specification is at `agentclientprotocol.com`.

ACP defines these content block types for a prompt turn
([ACP content spec](https://agentclientprotocol.com/protocol/v1/content)):

- **Text.** Field `text` (required). Every agent must support text.
- **Image.** Fields `data` (base64, required), `mimeType` (required), `uri` (optional). Requires the
  `image` prompt capability.
- **Audio.** Fields `data` (base64, required), `mimeType` (required). Requires the `audio` prompt
  capability.
- **Embedded resource.** Field `resource` (required), which is either a text variant (`uri` and
  `text` required) or a blob variant (`uri` and `blob` base64 required). The spec calls this "the
  preferred way to include context in prompts." Requires the `embeddedContext` prompt capability.
- **Resource link.** Fields `uri` (required) and `name` (required), plus optional `mimeType`,
  `title`, `description`, `size`. This is a pointer to a resource the agent may fetch, not content
  the model is guaranteed to perceive.

The decisive fact for this project: for an image, an audio clip, or an embedded document, the bytes
are **required** and travel inline as base64 in the turn. There is no content type that hands the
model a bare URL and guarantees the model reads it. A resource link is only a pointer; whether the
model ever sees the file depends on the agent choosing to fetch it with a tool.

Prompt capabilities are three flags the agent advertises at start-up: `image`, `audio`, and
`embeddedContext`. Each gates the matching content type
([ACP content spec](https://agentclientprotocol.com/protocol/v1/content)).

### What our runner does with capabilities today

The runner probes the harness's capabilities through the sandbox-agent library, which surfaces the
ACP capabilities as an `AgentInfo.capabilities` object. The runner maps that into its own
`HarnessCapabilities` shape (`capabilities.ts:68`, `mapCapabilities`), which includes `images` and
`fileAttachments` flags (`protocol.ts:281`). But it only ever branches on the tool-related flags
(`mcpTools`, `toolCalls`); the `images` and `fileAttachments` flags are assigned and then read
nowhere (a grep for `.images` in `services/runner/src` finds only the assignment at
`capabilities.ts:86`). So the runner receives the capability values but never uses them. This
project makes the runner enforce them. More on the history in section 9.

### What the pinned adapters actually do

This is where "the model perceives it" meets reality, because each adapter maps ACP content to its
own model API in its own way. Rather than infer this from documentation, the following comes from
reading the published packages themselves: the two the runner pins today, and the Codex adapter
from PR #5509.

**The Claude adapter (`@agentclientprotocol/claude-agent-acp` 0.58.1).** The adapter file is
`node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js`.

- It advertises `promptCapabilities: { image: true, embeddedContext: true }` (near line 418). It
  does **not** advertise audio.
- In its prompt conversion (near lines 3900 to 3925): an ACP image becomes a native Claude image
  block; a `resource_link` becomes a text link; a text resource becomes a URI link plus a
  `<context ref="...">` text block; and a blob resource is **explicitly ignored**, with the code
  comment "Ignore blob resources (unsupported)."
- The consequence is blunt. A PDF sent as an ACP blob resource never reaches Claude at all through
  this adapter. It is dropped in the conversion.

Why the blob drop exists: it is the adapter's choice, not an SDK constraint. The Claude Agent SDK
types a user message as an Anthropic `MessageParam`, and the Anthropic SDK's `ContentBlockParam`
includes a native `document` block that accepts a base64 PDF source
(`@anthropic-ai/sdk@0.115.0`, `resources/messages/messages.d.ts:555` and `:579`), so the adapter
could map a PDF blob the same way it already maps images. Nobody has asked upstream: searches of
`agentclientprotocol/claude-agent-acp` issues and PRs (open and closed) for "pdf", "blob",
"document", and "attachment" on 2026-07-31 found nothing requesting inbound blob or PDF prompt
support, and the ignore path is unchanged on the repo's main branch (`src/acp-agent.ts:6895`).

Why audio is missing: the Anthropic Messages API has no audio input block at all. The string
"audio" appears nowhere in `ContentBlockParam` (`@anthropic-ai/sdk@0.115.0`,
`resources/messages/messages.d.ts`), so the adapter has nothing to map ACP audio onto; the
limitation is inherited from the API, not chosen by the adapter. An issue search for "audio" on the
adapter repo returned zero results on 2026-07-31.

Newer versions: the latest published version is `0.64.0` as of 2026-07-31
(`npm view @agentclientprotocol/claude-agent-acp version`). Modality behavior is unchanged between
`0.58.1` and `0.64.0`. The advertised capabilities are still `{ image: true, embeddedContext: true }`
with no audio (`0.64.0` tarball, `dist/acp-agent.js:622`), the blob branch still carries the comment
"Ignore blob resources (unsupported)" (`dist/acp-agent.js:5363`), and audio blocks are still skipped
under "Ignore audio and other unsupported types" (`dist/acp-agent.js:5387`). Upgrading the pin would
change none of the modality behavior described above.

**The Pi adapter (`pi-acp` 0.0.29).** The adapter file is `node_modules/pi-acp/dist/index.js`.

- It advertises `promptCapabilities: { image: true, audio: false, embeddedContext:
  process.env.PI_ACP_ENABLE_EMBEDDED_CONTEXT === "true" }` (near line 1696). Audio is off, and
  embedded context is off unless an environment variable turns it on.
- In its prompt conversion (near lines 1470 to 1495): images pass through as image inputs; a text
  resource is inlined into the message text as `[Embedded Context] uri (mime)\n<text>`; a blob
  resource becomes only the line `[Embedded Context] uri (mime, N bytes)` with no content at all;
  and an audio block, if one arrived despite the capability being off, becomes the text line
  `[Audio] (mime, N bytes) not supported by pi-acp` (line 1493).
- The consequence is that a document sent as a blob to the Pi adapter reaches the model as a byte
  count, not as the document.

The adapter is community-maintained at [svkozak/pi-acp](https://github.com/svkozak/pi-acp), not by
earendil-works. Why the blob placeholder and the env gate exist: Pi's RPC prompt interface accepts
only a message string plus an images array, so the adapter has no first-class way to forward
arbitrary embedded resources. The maintainer gated `embeddedContext` behind
`PI_ACP_ENABLE_EMBEDDED_CONTEXT` in [pi-acp PR #12](https://github.com/svkozak/pi-acp/pull/12)
(merged) precisely to avoid "advertising broader support than we actually have" while blob
resources degrade to a placeholder. No issue tracks un-gating it or adding blob translation; a
sweep of all 92 issues and PRs in the repo on 2026-07-31 found nothing beyond PR #12 touching
`embeddedContext`. The `audio: false` flag follows from the same message-plus-images RPC shape; the
only issue matching "audio" (#58) is about session listing, not audio.

The runner also applies a local patch to this pin (`services/runner/patches/pi-acp@0.0.29.patch`).
It only adds two environment variables for the skill and session directories; it does not touch
content conversion or capabilities.

Newer versions: the latest published version is `0.0.33` as of 2026-07-31
(`npm view pi-acp version`). Modality behavior is unchanged between `0.0.29` and `0.0.33`. The
advertised capabilities are byte-for-byte the same, including `audio: false` and the env-gated
`embeddedContext` (`0.0.33` tarball, `dist/index.js:1937`), and the conversion is the same code at
new offsets: the blob byte-count line at `dist/index.js:1671` and the audio not-supported line at
`dist/index.js:1681`. The only capability delta is a new session `delete` capability, which is not
modality related.

A Pi extension can close one of these gaps. Pi loads extensions from its agent directory, and our
runner already installs one there for tool relay and tracing
(`services/runner/src/extensions/agenta.ts`, installed by
`services/runner/src/engines/sandbox_agent/pi-assets.ts`). The extension API lets an extension
register a custom tool (`registerTool`, `@earendil-works/pi-coding-agent` 0.80.6,
`dist/core/extensions/types.d.ts:874`) whose result carries real image content blocks back to the
model: `AgentToolResult.content` is typed as text or image content (pi-agent-core 0.80.6,
`dist/types.d.ts:306`), the agent loop copies that content verbatim into the tool-result message
(pi-agent-core, `dist/agent-loop.js:528`), and the Anthropic serializer emits real base64 image
blocks from it (pi-ai 0.80.6, `dist/api/anthropic-messages.js:875`). Pi's own read tool returns
exactly this shape for images (`dist/core/tools/read.js:183`). So a custom tool that renders PDF
pages to PNG images and returns them as image blocks works against the pinned version with no
change in Pi; the remaining work is ours (a PDF rasterizer available to the extension, and our
extension's relay currently returns text only, `services/runner/src/tools/dispatch.ts:71`). That
closes the tool-mediated document gap, at the agent's discretion like any tool call. The inline
gap is different. An extension can transform the incoming prompt and attach images to the very
user message being sent (the `input` event, `dist/core/extensions/types.d.ts:614` and `:628`,
delivered into the user message at `dist/core/agent-session.js:849`), but by the time it runs, a
blob's bytes are already gone: the pi-acp adapter has reduced the blob to the byte-count line
above, so the extension sees only the placeholder. Closing the inline document path therefore
needs changes in pi-acp, and a native document input would need changes in Pi itself, whose
message model carries only text, thinking, and image content (pi-ai 0.80.6,
`dist/types.d.ts:217`).

**The Codex adapter (`@agentclientprotocol/codex-acp` 1.1.7).** This adapter arrives with the Codex
harness in PR #5509. That PR pins it at `1.1.7`, which bundles `@openai/codex` `0.145.0`, in the
runner image build (`services/runner/docker/Dockerfile.gh:100` on branch `feat/codex-harness`, via
`install-agent codex --agent-process-version 1.1.7`) and records the pin under `runtimeAgentPins` in
`services/runner/package.json:10` on that branch. The published package ships one bundle,
`dist/index.js`; line numbers below refer to the `1.1.7` tarball from npm.

- It advertises `promptCapabilities: { embeddedContext: true, image: true }` (near line 28486). It
  does **not** advertise audio.
- In its prompt conversion (`buildPromptItems`, near lines 26708 to 26744): an ACP image becomes a
  native Codex image input (an `http`, `https`, or `data` URI passes through as a URL; inline base64
  becomes a data URL); a `resource_link` becomes a text link; a text resource becomes a URI link
  plus a `<context ref="...">` text block; a blob resource with an image MIME type becomes a native
  image input; any **other** blob resource becomes a text block that contains the raw base64 inside
  `<context ref="..." mimeType="..." encoding="base64">`; and an audio block is dropped (the case
  returns null).
- The consequence for documents differs from both other adapters. A PDF sent as a blob is neither
  dropped nor reduced to a byte count; its base64 characters are pasted into the prompt as text. The
  model receives characters, not a parsed document, so this is still not native document perception,
  and it spends prompt tokens on base64.

Newer versions: `1.1.7` is the latest published version as of 2026-07-31
(`npm view @agentclientprotocol/codex-acp version`), so the pin and the latest are the same.

### What the adapters support today

Three consequences follow, stated plainly.

- Image delivery works end to end on all three adapters. An inline ACP image reaches the model as a
  real image it perceives.
- Native audio is unsupported by all three adapters today. None advertises the audio capability, so
  there is nothing to deliver audio into.
- Native document delivery does not work today. The Claude adapter drops a blob resource entirely,
  the Pi adapter renders it as a byte count, and the Codex adapter pastes its base64 into the prompt
  as text. A PDF sent as a blob reaches none of the models as a document.

Resource links are handled as pointers by all three. The agent may or may not fetch them.

At the protocol level, ACP itself has no document content type; the `ContentBlock` union is exactly
text, image, audio, resource link, and embedded resource (`@agentclientprotocol/sdk@1.3.0`,
`dist/schema/types.gen.d.ts`), so a PDF can only ever travel as a blob resource. No spec issue or
discussion proposes a document type (searches of `agentclientprotocol/agent-client-protocol` for
"pdf", "blob resource", and "document" on 2026-07-31 found nothing on point). The one audio-related
thread, [ACP discussion #1591](https://github.com/orgs/agentclientprotocol/discussions/1591), asks
what channel clients should do with media agents cannot ingest and was open and unanswered as of
2026-07-31. So richer-media handling is an open question at the protocol level, and no adapter has
upstream work in flight to close these gaps.

One note for [design.md](design.md): the D5 adapter-fidelity table describes two document behaviors
(Claude drops the blob, Pi renders a byte count). The Codex adapter adds a third behavior, base64
pasted as text. None of the three is native document perception, so the D5 conclusion that document
delivery is blocked on adapter work stands unchanged; the table gains a column when PR #5509 lands.

### What the harnesses' own read tools deliver from disk

A file on disk is not invisible to the model. Each harness ships a tool that can turn a file the
agent reads into native model input, with different coverage per kind, verified against the pinned
versions on 2026-07-31, empirically on our stack for Claude and Pi (sessions `ebef4364` and
`54770cc0`) and from source for Codex.

- **Claude Code reads images and PDFs natively.** Its Read tool returns an image file "as visual
  content that Claude can see, not as raw bytes"
  ([Claude Code tools reference](https://code.claude.com/docs/en/tools-reference#read-tool-behavior))
  and returns a PDF as a native document input (PDF support since v1.0.58; page ranges since
  v2.1.30; limits 100 pages and 20 megabytes). This rests on an API fact: a `tool_result` may carry
  `text`, `image`, and `document` blocks
  ([handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)).
  On our stack (Claude Code 2.1.205 through the pinned adapter), an agent asked to read an uploaded
  photo named its exact shapes and text, and read a compression-locked PDF verbatim, with no bytes
  in the prompt. An earlier version of this document cited
  [claude-code #35866](https://github.com/anthropics/claude-code/issues/35866) and
  [#30925](https://github.com/anthropics/claude-code/issues/30925) as evidence that Read does not
  deliver vision. Both are now closed, and neither supports that reading today: #30925 described
  behavior that no longer exists, and #35866 concedes that Read sends the image and complains about
  edge cases (delivery on Bedrock, media type detected from the file extension, corrupt files
  breaking a session), several of which have since shipped fixes (format detection from bytes in
  2.0.65, a text fallback for mislabeled files in 2.1.144).
- **Pi reads images natively and nothing else.** Its read tool (pi-coding-agent 0.80.6,
  `dist/core/tools/read.js`) detects jpg, png, gif, webp, and bmp by magic bytes and returns a real
  image content block, omitted with a notice when the model has no vision. A PDF falls into the
  text branch and reaches the model as a UTF-8 decode of raw bytes; on our stack the agent reported
  the raw PDF source and could not recover the document's text.
- **Codex reads images natively through `view_image`.** The tool is enabled by default and returns
  the file as an `input_image` content item (openai/codex,
  `codex-rs/core/src/tools/handlers/view_image.rs`; shipped in rust-v0.26.0). No tool delivers a
  local PDF natively; Codex's own skills shell out to converters.
- **No harness has any tool path for audio.** The Anthropic API accepts no audio input at all, Pi's
  read tool has no audio branch, and every shipped Codex model declares text and image only.

So the disk path does give perception for images on every harness, and for PDFs on Claude only, but
always at the agent's discretion: nothing forces the tool call, and a conversation rebuilt from
records does not re-read files. Section 5 weighs this against inline delivery.

### Server-side transcription, surveyed and deferred

Decision D14 ([design.md](design.md)) defers server-side transcription of recorded audio out of the
first release. This survey (2026-07-31) records what the deferred follow-up restarts from, so that
decision begins from facts rather than from scratch.

- **The browser cannot fill the gap.** The Web Speech API transcribes only a live microphone
  stream, which is why the composer's dictation mode works and a recorded blob cannot be
  transcribed client-side. Chrome 139 can replay a blob through recognition, but that path is
  Chrome-only, runs at real-time speed, and produces no server-side transcript. The limit is
  structural, so recorded audio needs a server-side service or none at all.
- **The call path already exists in our dependencies.** The pinned litellm 1.92.0 (`api/uv.lock`,
  `services/uv.lock`) ships `/audio/transcriptions` support for OpenAI, Mistral, and Deepgram, plus
  Groq through its OpenAI-compatible route. So a person's stored OpenAI, Groq, or Mistral key could
  transcribe through infrastructure Agenta already runs, and the same call path could carry an
  Agenta platform key for people without keys.
- **Prices are negligible.** A 30-second note costs about $0.003 on OpenAI's transcription models,
  about $0.0003 on Groq's Whisper large-v3-turbo ($0.04 per hour), and about $0.0015 on Mistral's
  Voxtral Mini Transcribe.
- **Subscription-auth users have no bring-your-own path.** Anthropic has no transcription API, and
  neither does the Codex OAuth surface, so a person authenticated through a Claude or ChatGPT
  subscription holds no key that could transcribe.
- **Self-hosters could run it locally.** faster-whisper's small model in the services layer
  transcribes a 30-second note in about 4 seconds of CPU.
- **Gaps at this pin.** AssemblyAI has no litellm support, and Gemini cannot route as transcription
  at litellm 1.92.0.

---

## 5. Two ways to deliver a file to the model, compared

The design has to choose how the file reaches the model. There are two mechanisms, and they are not
interchangeable. This comparison answers the question of why the design delivers inline ACP content
rather than only writing the file into the sandbox and mentioning its path.

**Mechanism A: inline ACP content blocks.** The runner reads the file and puts its bytes into an
ACP image, audio, or embedded-resource block in the turn. The harness maps that to the model's
native content path.

- Gives the model real perception of the file. For images this is confirmed to work through both
  pinned adapters (see section 4).
- Requires the bytes at prompt time, and requires the harness to advertise the matching capability.
- Is the only path that could ever work for audio, because there is no tool-read fallback for
  audio at all. Note that neither pinned adapter supports native audio today (section 4), so audio
  is blocked on adapter work even though inline delivery is its only possible route.

**Mechanism B: write the file into the sandbox and mention its path in the prompt text.** The runner
writes the file into the agent's working directory and the prompt says something like "the file is
at attachments/photo.png."

- Lets the agent's tools open, convert, or edit the file. This is real value for non-native
  formats.
- Gives the model perception only when the agent chooses to call its read tool, and only for the
  kinds that harness's tool handles: images on all three harnesses, PDFs on Claude Code only, audio
  nowhere (section 4). The perception is real when it happens, but it is agent-mediated and uneven
  across harnesses, and a turn replayed from records does not repeat it.
- Is the natural path for formats that are not native model inputs anyway (a zip, a CAD file), where
  perception is not even the goal.

The conclusion the design draws: use both, for different purposes. Inline delivery (Mechanism A) is
the only path that guarantees perception: it happens deterministically at the prompt-build seam the
runner owns, works the same on every harness that advertises the capability, and survives a replay.
The disk copy (Mechanism B) serves tool use, and on some harnesses it adds a second, agent-driven
route to perception, which is a useful fallback rather than a substitute. This is not redundant. The
two mechanisms serve the two separate outcomes from [context.md](context.md): perception and tool
use.

---

## 6. How other tools handle attachments

Looking at how mature tools handle this gives us patterns for the flow and for who owns each step.

### Zed

Zed's editor is the client in ACP. When a person attaches or pastes an image in Zed's agent panel,
Zed sends it as an ACP image content block, which the Claude Code adapter turns into a native Claude
image block. File mentions become resource references. So Zed's own behavior confirms the inline
content path for images.
[Zed on Claude Code via ACP](https://zed.dev/blog/claude-code-via-acp).

### opencode

opencode is a terminal-first coding agent. Its attachment behavior
([opencode attachments docs](https://v2.opencode.ai/attachments)):

- **How files are attached.** By an attach action, by paste, or by drag and drop. In the terminal a
  person references a file with `@filename`, which does a fuzzy search in the working directory and
  inserts the file's content into the conversation.
- **How they reach the model.** Inline in the prompt, not as a path reference. Text files are decoded
  and inserted as text. Images (PNG, JPEG, GIF, WebP) are passed as the provider's native image
  input. SVG is treated as text. PDF, audio, and video are not sent to the model at all.
- **Where the bytes live.** opencode does not describe durable storage. Files are materialized at
  prompt time from the path or the inline data URL.
- **Who owns what.** The client collects the file and applies a client-side size limit (up to 20
  mebibytes). The server validates the path and enforces a decoded-size limit per attachment. The
  model provider applies its own format and size limits.

The patterns worth taking from opencode: attachments are delivered inline to the model; only a small
set of image formats get native handling; everything else is text or is refused; and there is a clear
split where the client collects and pre-limits, the server validates, and the provider has the final
say on limits.

### Others

Claude Code supports `@`-file mentions that pull a file's content into the context, similar to
opencode. The general industry pattern across these tools is: images go as native image content;
plain text and code are inlined as text; unusual binaries are either refused or handled as files an
agent tool must open. None of them rely on handing the model a bare link and trusting it to fetch.

---

## 7. Records and replay

### What exists

Our system already keeps a durable, per-session log called **records**. The runner posts every
agent event to the API's record-ingest endpoint, independent of whether any browser is listening
(`services/runner/src/sessions/persist.ts`, whose header comment describes the "producer-driven"
model and the `POST /sessions/records/ingest` endpoint). Each record is tagged with a
`record_source` of `"agent"` for engine events or `"user"` for the inbound user turn. The API has a
records sub-router with an ingest route and a query route (`RecordsRouter` at
`api/oss/src/apis/fastapi/sessions/router.py:435`; the file header lists
`POST /sessions/records/query`).

Separately, when the runner starts a session that is not already warm, it rebuilds the conversation
from the durable records (`services/runner/src/engines/sandbox_agent/reconstruct-history.ts`, which
calls the fold in `services/runner/src/sessions/reconstruct.ts`) and then flattens it to text for
the harness (`transcript.ts`). This "cold replay" renders an image block as the literal
`"[image]"`, and a past user attachment does not even get that far: the records store only the
text, so the rebuilt user turn has no image block at all.

### Records are text-only today

The record path carries text and nothing else right now. The runner persists the inbound user
record as text (`services/runner/src/server.ts`, near line 1084), and the record event schema
allows only the shape `{ type: "message", text }` (`services/runner/src/protocol.ts`, near line
325). There is no field in a record for an attachment. On a warm turn the runner sends only the
latest user text; on a cold start it rebuilds prior turns from the records
(`reconstruct-history.ts`) and flattens the whole transcript to text (`run-turn.ts`, near line
196), where the rebuilt user turn carries no trace of the attachment at all.

Two things follow for this project. First, carrying an attachment reference in a record requires
extending the record schema, because the schema has no place to put one today. Second, cold replay
loses past attachments entirely: a user turn rebuilt from records is text only, so the attachment
does not even appear as a placeholder. This is why the plan makes the record-schema change part of the first
release rather than a later addition: without it, a reference cannot survive in the durable log at
all.

### The direction, now shipped

The session-storage rework shipped and is on by default (PR #5560, merged 2026-07-30). The front
end sends only the last message on each turn instead of resending the whole history
(`NEXT_PUBLIC_SESSIONS_LAST_MESSAGE_ONLY`, read in `agentRequest.ts`). The runner owns rebuilding
the conversation from records when a session cannot be resumed warm, for example after a crash
(`AGENTA_SESSIONS_RECONSTRUCT`,
`services/runner/src/engines/sandbox_agent/reconstruct-history.ts`). Responsibility for history
moved from the front end to the runner. The reference-based attachment design fits this cleanly,
because a reference is exactly what a record should store for a shared file: the record points at
the durable original rather than carrying its bytes.

### The tracking issue

This direction was tracked in
[#5443, "(feat) Runner should rebuild session context from records when a session cannot be resumed warm"](https://github.com/Agenta-AI/agenta/issues/5443)
and shipped with PR #5560.
The related warm case is
[#5384, "(feat) Warm sessions should hold client tool calls open instead of replaying the turn"](https://github.com/Agenta-AI/agenta/issues/5384):
issue #5384 avoids a replay when the session is still alive, while the rebuild from records covers
the case when it is not. The rebuild itself is outside this project's scope; what this project
contributes is that records will carry small references to durable originals, which is what a
faithful rebuild needs.

---

## 8. Assistant-produced files

The runner protocol declares an event type for a file the agent produces:
`{ type: "file"; url: string; mediaType: string }` (`protocol.ts:379`), which the comment says maps
to a Vercel `file` part on the way to the front end. But **nothing emits it.** A search across the
runner source for that event type finds only its declaration, no producer. The protocol defines the
event, but no runner code emits it.

How this normally works elsewhere: an agent writes the file into its working directory and
mentions it in its answer, but neither Zed nor opencode recognizes file references by scanning the
prose or the working directory. The affordance always rides structured data on the wire: ACP
tool-call `locations` entries carrying absolute paths, `resource_link` blocks the agent emits, or
(in Zed only) a strict existence check on backticked code spans against the worktree, with no
fuzzy matching. opencode renders no file links from agent text at all; every file affordance there
comes from tool-call inputs. For our product this means assistant-produced files are a
separate piece of work: making the agent write to `cwd` and surfacing the new file in the drawer is
already close to working (the drawer lists `cwd`), while a first-class "assistant returned this file"
inline chip is the not-yet-built part. This project treats assistant-produced files as out of scope
(see [scope.md](scope.md)).

---

## 9. The capability flags

The neutral capability set, including `images` and `file_attachments`, was introduced with the
original agent-runtime protocol work (`sdks/python/agenta/sdk/agents/dtos.py`, class
`HarnessCapabilities`; introduced in commit `b9e62f99aa`, "feat(sdk): agent runtime ports, adapters,
tool resolution, and messages protocol"). The matching TypeScript shape is `HarnessCapabilities` in
`protocol.ts:281`.

The intent is documented right in the code. The docstring on the Python `HarnessCapabilities` says
adapters should "deliver tools over MCP only when `mcp_tools` is set, skip image blocks without
`images`" (`dtos.py`). The tool half of that intent was built: `assertRequiredCapabilities`
(`capabilities.ts:169`) refuses a run that carries tools when the harness lacks `mcpTools` and
`toolCalls`. The image half was not built: there is no code that skips or gates image blocks on the
`images` flag, because no code sends image blocks at all yet (section 1). So the flags are not so
much abandoned as built ahead of the feature that would use them. This project is that feature. It
should reuse the same "fail loud when a required capability is missing" pattern the tool gate already
uses, rather than invent a new one.

Note the difference between two capability vocabularies that are easy to confuse:

- **ACP prompt capabilities:** `image`, `audio`, `embeddedContext`. External. Advertised by the
  harness. These gate ACP content types.
- **Our harness capability flags:** `images`, `fileAttachments`, and the rest in
  `HarnessCapabilities`. Ours. Derived from the probe. The design maps the ACP prompt capabilities
  into a clear internal set of `images`, `audio`, and `documents` and gates on that. The mapping and
  the exact contract across layers are in [design.md](design.md) and [plan.md](plan.md).

---

## 10. The front-end adapter and its current limits

### What the adapter parses

Our SDK's Vercel adapter turns an inbound `file` part into a content block
(`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:97`). The rule is: if the media type
starts with `image/`, the block type is `image`; otherwise it is `resource`. The block carries the
`uri` (from the part's `url`), the `data` (base64, if present), and the `mime_type`. On the way back
out, both `image` and `resource` blocks render as a Vercel `file` part (`_block_to_parts`,
`messages.py:310`).

So the content-block vocabulary our system produces from the front end is: `text`, `image`,
`resource`, `tool_call`, `tool_result`. There is **no audio block.** Audio, video, and every
document all collapse to `resource` today. Adding a first-class `audio` block is part of this work.

The front-end helper `fileKind` (`web/oss/src/components/AgentChatSlice/assets/files.ts:11`) already
recognizes image, audio, video, and file, so the front end can tell audio apart even though the wire
cannot carry it as audio yet.

### The current limits and where they came from

The front-end attachment limits live in
`web/oss/src/components/AgentChatSlice/assets/attachments.ts` (`DEFAULT_ATTACHMENT_LIMITS`,
verified 2026-07-31, merged in PR #5459):

- At most 5 files per message, across all kinds.
- Per-kind size caps: 10 megabytes per image, 15 megabytes per audio clip, 10 megabytes per
  document.
- Accepted kinds and types: image (`image/`), audio (`audio/`), document (`application/pdf`,
  `text/`, `application/json`).

The limits are one value object so they can later be replaced with limits derived from the selected
model and harness capabilities; the file's own comment names narrowing `kinds` as the seam that
capability gating plugs into. The numbers are sized against the transport, not against any model
limit: the file's header notes that while attachments ride the request body, the real ceiling is the
gateway's `client_max_body_size` (10 megabytes on the compose stack) plus base64 inflation of about
a third, which also means the 15 megabyte audio cap exceeds what the compose gateway accepts today.
Section 3 has the real provider limits the caps should eventually be derived from. These limits are
enforced client-side only; nothing checks them server-side today. The front end sends files inline
as base64 `data:` URLs (`files.ts`, `fileToPart`), which is exactly the mechanism the
reference-based design replaces. The upload lifecycle hook (`useAttachmentUploads`) ships with a
deliberate transport seam: no uploader is wired, so staged files sit ready-to-send and the
progress, failure, and retry flow activates when Stage 1 provides an uploader.
