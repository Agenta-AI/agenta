# Context

## Why this work exists

Agent workflows are text-only at the model. A user can attach an image or a document in the
agent chat composer, the bytes travel intact all the way to the runner, and then the runner
throws them away one line before the harness. The model never sees a pixel. The prompt
(non-agent) workflow, by contrast, is genuinely multi-modal — it passes OpenAI content parts
straight to LiteLLM. So agents regressed relative to prompts, and the gap is invisible to the
user: attachments look accepted, then silently do nothing.

Everything below is verified against the code, not doc comments.

## What is actually wired (and where it dies)

The attachment path is wired end-to-end **except the last hop**. The bytes reach the runner and
are dropped there.

| Hop | File | Multi-modal? |
| --- | --- | --- |
| Composer picker / drag / paste / preview | [`web/oss/src/components/AgentChatSlice/assets/files.ts:21`](../../../../../web/oss/src/components/AgentChatSlice/assets/files.ts) | ✅ base64 `data:` URL as AI-SDK `FileUIPart` |
| Request body `data.inputs.messages[].parts[]` | [`web/packages/agenta-playground/src/state/execution/agentRequest.ts:406`](../../../../../web/packages/agenta-playground/src/state/execution/agentRequest.ts) | ✅ |
| Vercel adapter parses the part | [`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:97`](../../../../../sdks/python/agenta/sdk/agents/adapters/vercel/messages.py) | ✅ → `ContentBlock(type="image"｜"resource")` |
| SDK handler → wire | [`sdks/python/agenta/sdk/agents/utils/wire.py:133`](../../../../../sdks/python/agenta/sdk/agents/utils/wire.py) | ✅ base64 intact |
| Runner ingest | `services/runner/src/server.ts` | ✅ intact |
| **Runner → harness** | [`services/runner/src/engines/sandbox_agent/run-turn.ts:478`](../../../../../services/runner/src/engines/sandbox_agent/run-turn.ts) | ❌ **hard-coded `[{type:"text", text: turnText}]`** |

`grep -rn "session.prompt" services/runner/src/` returns exactly one real call site — line 478.
`turnText` is derived by [`messageText()`](../../../../../services/runner/src/protocol.ts) at
`protocol.ts:557`, which filters `block?.type === "text"` and joins. Everything else vanishes.

Three concrete failure modes:

1. **Image + text** → the model gets only the text. On cold replay it gets the literal string
   `"[image]"` ([`transcript.ts:177`](../../../../../services/runner/src/engines/sandbox_agent/transcript.ts)).
2. **Image, no text** → the run is *rejected*: `resolvePromptText` returns `""` and
   [`run-plan.ts:313`](../../../../../services/runner/src/engines/sandbox_agent/run-plan.ts)
   fails with `"No user message to send (prompt/messages empty)."`
3. **No gating anywhere.** The paperclip is disabled (see below) but paste and drag are not, so a
   pasted screenshot reaches the wire and silently dies.

## The FE is wired but the button is a cosmetic gate

The paperclip is hard-disabled — commit `d4b119af26`, *"disable button until functionality is
ready"* ([`AgentConversation.tsx:2228`](../../../../../web/oss/src/components/AgentChatSlice/AgentConversation.tsx)):
`disabled={true}`, tooltip "Attach files coming soon". But the gate leaks by design — its own
comment says *"paste / drag-to-add still work"*:

- Paste → `onPasteFile` → `addFiles` (ungated).
- Drop → `onDrop` → `addFiles` (ungated).
- Either path calls `setAttachmentsOpen(true)`, revealing the panel whose **own** file picker is
  fully enabled.

So one pasted screenshot bypasses the disable entirely. And `sendForceEnabled={files.length>0}`
lets an image-only message send with no text — straight into failure mode 2.

Attachment limits (`DEFAULT_ATTACHMENT_LIMITS`: 5 files, 5 MB each, `image/*`,
`application/pdf`, `text/*`, `application/json`) are **arbitrary placeholders**, not
capability-derived — the design doc for them says so. They can change freely.

## The capability plumbing exists but is write-only

Capability flags were designed and abandoned mid-flight:

- Agenta flags exist in TS ([`protocol.ts:283`](../../../../../services/runner/src/protocol.ts) —
  `images?`, `fileAttachments?`) and Python ([`dtos.py:187`](../../../../../sdks/python/agenta/sdk/agents/dtos.py)).
- `dtos.py:187` documents the intent — adapters *"skip image blocks without `images`."*
  **No such skip exists.** `capabilities.images` is assigned once at
  [`capabilities.ts:86`](../../../../../services/runner/src/engines/sandbox_agent/capabilities.ts)
  and read nowhere. The static fallback hardcodes `images: false` with no effect.
- Per-model `modalities` metadata exists
  ([`model_catalog.py:75`](../../../../../sdks/python/agenta/sdk/agents/model_catalog.py); Claude
  curated data is `["text","image"]`) and is surfaced to the FE type at
  [`inspectMeta.ts:52`](../../../../../web/packages/agenta-entities/src/workflow/state/inspectMeta.ts).
  Nothing reads it to make a decision.

## Constraint: ACP is an external standard we cannot bend

The runner speaks **ACP — the Agent Client Protocol**, an external standard published by **Zed
Industries** (`@agentclientprotocol/sdk`, pinned at
[`services/runner/package.json:23`](../../../../../services/runner/package.json); spec at
`agentclientprotocol.com`). It is the same protocol Zed and other editors use to talk to coding
agents like Claude Code. We do not own it.

Its content model is decisive (from the SDK's `types.gen.d.ts`, v0.26):

- `ImageContent.data` — **required** (base64). `uri` is optional and decorative.
- `AudioContent.data` — **required** (base64).
- `EmbeddedResource` → `BlobResourceContents.blob` — **required** (base64).
- `ResourceLink` — URI only, no data — but this is a *pointer the agent may fetch with a tool*,
  not content the model is guaranteed to perceive.
- Gating: `promptCapabilities: { image, audio, embeddedContext }`.

Two consequences that shape the whole design:

1. **There is no "pass a URL, the model reads it."** Anything the model actually perceives must
   be inline base64 at the `session.prompt()` boundary. Storing files in S3 does not remove that
   requirement — it only removes base64 from the *resent history*.
2. **The runner never reads `promptCapabilities`.**
   `grep -rn "promptCapabilities\|agentCapabilities" services/runner/src/` → zero hits. The
   authoritative modality signal from the protocol is ignored. Wiring it is part of this work.

Note the two `ContentBlock` vocabularies, easily conflated:

| Type | Owner | Modalities | Where |
| --- | --- | --- | --- |
| ACP `ContentBlock` | Zed (external) | text, image, **audio**, resource_link, resource | runner → harness ([`run-turn.ts:478`](../../../../../services/runner/src/engines/sandbox_agent/run-turn.ts)) |
| Agenta `ContentBlock` | ours | text, image, resource — **no audio** | FE → runner ([`protocol.ts:12`](../../../../../services/runner/src/protocol.ts), [`dtos.py:229`](../../../../../sdks/python/agenta/sdk/agents/dtos.py)) |
| OpenAI content parts | OpenAI/LiteLLM | image_url, file, input_audio | prompt lane ([`rendering.py:147`](../../../../../sdks/python/agenta/sdk/utils/rendering.py)) |

Our block type is a **narrower mirror** of ACP's and is missing `audio` — we add it. The
external spec and the harness already support image and audio; the whole build is on **our** side
of line 478.

## The substrate we build on: mounts

There is already an S3-backed file subsystem — **mounts**
([`api/oss/src/core/mounts/service.py`](../../../../../api/oss/src/core/mounts/service.py),
router at `api/oss/src/apis/fastapi/mounts/router.py`, session-scoped view at
`api/oss/src/apis/fastapi/sessions/router.py:885`). Facts that matter:

- **Session mounts are get-or-create, keyed deterministically on `session_id`.**
  `sign_session_mount_credentials` calls `get_or_create_session_mount`; the slug is
  `uuid5(namespace, session_id)` ([`service.py:79`](../../../../../api/oss/src/core/mounts/service.py)).
  Signing *is* provisioning — idempotent upsert on `unique(project_id, slug)`, no 409 dance.
- **A session can have multiple named mounts, each its own prefix.**
  `get_or_create_session_mount(session_id, name=...)` → `name="cwd"` is the working directory;
  any other name is *"an additional session-scoped mount sharing the same shape with its own
  prefix"* ([`service.py:411`](../../../../../api/oss/src/core/mounts/service.py)). Storage key is
  `mounts/<project_id>/<mount_id>/<path>`.
- **Upload takes a destination path.**
  [`utils.py:53`](../../../../../api/oss/src/apis/fastapi/mounts/utils.py) —
  `write_file(mount_id, path, content)`.
- **`cwd` is agent-writable, last-writer-wins.** The agent's own README says so:
  *"Concurrent runs share this folder, so the last writer wins for each file"*
  ([`agent-mount.ts:23`](../../../../../services/runner/src/engines/sandbox_agent/agent-mount.ts)).
  Anything in `cwd` can be deleted or overwritten by the agent.
- **Multi-mount-into-the-sandbox is already shipped.** `agent-files` is a *separate* mount
  because it has a *different lifecycle* — cross-session durable: *"Files here persist across all
  sessions and runs of this agent"* ([`agent-mount.ts:20`](../../../../../services/runner/src/engines/sandbox_agent/agent-mount.ts)).
  It is geesefs-mounted beside `cwd` and symlinked in as `agent-files/`. This is the pattern and
  the precedent.
- **The FE owns `session_id` before turn one.** New sessions get a client-side `generateId()`
  ([`sessions.ts:165`](../../../../../web/oss/src/components/AgentChatSlice/state/sessions.ts)),
  sent as the envelope `session_id`
  ([`agentRequest.ts:407`](../../../../../web/packages/agenta-playground/src/state/execution/agentRequest.ts)).
  The server never mints it — so there is no "session does not exist yet" window before the first
  attachment.
- **The Files drawer already groups by provenance.** DriveExplorer tags top-level nodes by origin
  and shows the distinction only when mixed
  ([`DriveExplorer.tsx:275`](../../../../../web/oss/src/components/Drives/DriveExplorer.tsx),
  `driveHasMixedOrigins` in `ContextRail.tsx:145`). "Shared by you" becomes a third origin, not a
  new section type. Internal/hidden path filtering already exists
  ([`service.py:146`](../../../../../api/oss/src/core/mounts/service.py) `_is_internal_mount_path`,
  `service.py:182` `_is_hidden_path`).

## Side effects the current design already causes (fixed for free by the reference model)

- **History resend amplification.** The full message history is resent every turn
  ([`agentRequest.ts:401`](../../../../../web/packages/agenta-playground/src/state/execution/agentRequest.ts));
  a 5 MB image is ~6.7 MB base64 re-uploaded on *every* subsequent turn — quadratic.
- **localStorage eviction bomb.** Messages persist with base64 inline
  ([`sessions.ts:106`](../../../../../web/oss/src/components/AgentChatSlice/state/sessions.ts));
  one attachment blows the ~5 MB budget and `writeMessagesWithQuotaGuard` responds by deleting
  *other sessions'* transcripts (`sessions.ts:409`).
- **Tracing payload bomb (Python side).** `_agent` is instrumented with
  `ignore_inputs=["request","inputs","parameters"]` — deliberately keeping `messages`
  ([`app.py:155`](../../../../../services/oss/src/agent/app.py)) — and there is no truncation or
  OTel attribute-length cap anywhere (`grep` across `services/`, `sdks/`, `api/` → zero). A
  base64 image lands verbatim in an exported span. (The runner's TS tracer strips non-text, so
  this is Python-only.)

Once history and traces carry a **reference** instead of base64, all three dissolve.

## Scope confirmed with the product owner

- **Audio must be supported.** (Forces inline `AudioContent` at the ACP boundary — there is no
  tool-read fallback for audio.)
- **PDFs / documents in scope**; FE limits may be reworked as needed (they were arbitrary).
- **Both intents:** the model perceives the file *and* the agent can operate on it — and whether
  the agent modifies it is the user's call per conversation, not a fixed platform policy.
- **Findability is a product goal:** a user must always be able to find, cleanly, what they
  shared — even after the agent has run.
