# Stage 1 implementation plan, revision 2: agent multi-modality

This plan turns Stage 1 of
`docs/design/agent-workflows/projects/agent-multi-modality/plan.md` into pull-request-sized work
packages. It does not reopen any decision: D1 through D14 are settled, and the media-type,
validation, and limits matrix in `design.md` is the authority on formats, caps, and rejection rules.
Every file path and line area below was re-checked against the working tree on 2026-07-31.

Revision 2 folds in the Codex critical review of revision 1 and the orchestrator's binding
adjudications. Where the two disagree, the adjudication wins.

Read in order. "Adjudicated decisions" says what changed and why, and feeds the stage protocol.
"Corrections to the design's code references" lists code the design text points at wrongly. "How
Stage 1 splits into pull requests" gives the shape. The four work-package sections give files,
contracts, migrations, tests, and acceptance criteria. "Design-doc sync" lists the design edits the
docs lane must make during WP1. "What I could not verify" lists what was inferred.

---

## Adjudicated decisions

What changed versus revision 1, and why. Each item cites the Codex finding and the ruling that
settled it.

1. **The package split is reader-first, not producer-first** (Codex "PR split and deployment order"
   → ruling "PR split: reader-first, four packages"). Revision 1 ordered API → wire contract →
   runner → frontend. The wire-contract package is a *producer* (the Vercel adapter emits blocks),
   so shipping it before the runner could emit a block nothing consumed. New order: WP1 API, WP2
   runner (consumer), WP3 SDK/agent-service (producer), WP4 frontend (producer), then the flag.
   Merge order equals deploy order, and the flag flip is a fifth, separate act.
2. **Every generic mount operation must treat the attachments mount as absent** (Codex P0-1 → ruling
   A2). Revision 1 guarded only `write_file`, `delete_path`, `create_folder`, and signing. A project
   member could still query the mount, list `<attachment_id>/<filename>`, download or export an
   original bypassing the session-binding check, and archive the mount. One `is_protected_mount()`
   policy in `MountsService` now covers query, fetch, list, read, download, export, edit, archive,
   unarchive, write, folder-create, upload, delete, and sign.
3. **The protected classification gets a server-owned `purpose` column, not just a slug match**
   (Codex "Immutability guard and slug matching" → ruling A2). Slug matching is mechanically stable
   today but is a naming convention, not a security classification. The migration adds
   `mounts.purpose`, set to `"session_attachment_originals"`, absent from `MountEdit` so it cannot be
   edited. The slug check stays as the transitional fallback for rows written before the column.
4. **The exception is `MountProtected`, not `MountImmutable`** (Codex → ruling A2). `MountImmutableField`
   already exists and means something else.
5. **The runner gets a first-class `currentUserTurn(request)`, as WP2's first commit** (Codex P0-2 →
   ruling A3). The runner today has no concept of "the current user turn", only "the most recent
   non-empty user text": `resolvePromptText` scans backward (`protocol.ts:585`), so an
   attachment-only turn after an earlier text turn resends the earlier text. The same assumption sits
   in `tailIsFreshUserMessage` (`session-identity.ts:344`), `historyFingerprint`
   (`session-identity.ts:213`, which hashes user text but no attachment ids), and the inbound-record
   persist guard (`server.ts:1082-1084`). Fixing the abstraction precedes writing any attachment
   resolution.
6. **An explicit claim operation replaces "the download route sets `referenced_at`"** (Codex P0-3 →
   ruling A4, which overturns revision 1's recommendation 5). A GET must not mutate lifecycle state,
   and the frontend's render path calls the same route, so merely previewing a staged attachment
   would make it immortal. New `POST /sessions/attachments/reference`; the runner claims after
   validating the current turn and before executing it. Recorded tradeoff: a claim leaked by a turn
   that later fails is tolerable; sweeping a durable conversation reference is not.
7. **Upload is bounded, row-first, and idempotent by client key** (Codex P0-4 → ruling A5). Revision 1
   copied `await file.read()` from `mounts/utils.py:85`, which buffers an arbitrarily large body
   before any policy applies — and the EE stack has no gateway body cap at all. Upload now reads in
   bounded chunks to the maximum raw cap plus one byte, inserts a `pending` row carrying a
   client-supplied idempotency key (unique per project + session), writes the object, then marks it
   `ready`. Downloads and claims resolve only `ready`. A reaper clears stuck `pending` rows and their
   orphan objects. This replaces revision 1's "a retry mints a new id" contract and fixes the
   contradiction in `plan.md` around line 120.
8. **Per-session quotas ship in Stage 1** (Codex P0-5 → ruling A6). Five files per message does not
   bound a hostile session, and D12 makes a cold start restore every referenced working copy, so an
   unbounded session is a runner amplification endpoint. Enforced at upload: 100 attachments and
   256 MB of ready-or-referenced bytes per session, 20 pending uploads. Cold-start restore runs with
   concurrency 4 and a per-file timeout. Upload rate limiting beyond this is out of Stage 1.
9. **Every current-turn attachment gets a mention line in the prompt** (Codex P1 → ruling A8).
   Revision 1's test asserted that a workspace-only attachment produces no native block and the turn
   still runs, which for an attachment-only ZIP is an empty prompt, and the agent never learns the
   id-namespaced path. Native blocks come first, then exactly one text block holding the mention
   lines plus the user text. This also makes an attachment-only turn valid.
10. **The delivery outcome is a structured chain, not an optional error field** (Codex P1 and
    recommendation 6 → ruling A9, which overturns revision 1's recommendation 6 as specified). A
    lonely terminal `errorCode` would be dead data: `result_from_wire` (`wire.py:162-172`) raises and
    discards every field but `error`, and the Vercel stream emits only `errorText`. The runner now
    emits an `attachment_delivery` event carrying `{attachmentId, outcome, reasonCode, workingPath}`,
    persisted with the records, parsed by the SDK, carried on the Vercel stream, and rendered on
    reload. This is the authoritative D6 notice; the composer's pre-send approximation stays a
    courtesy.
11. **Unknown model modalities mean workspace-only, and the fact is sourced at the resolved-connection
    boundary** (Codex recommendation 2 → ruling R2, overturning revision 1's recommendation 2).
    Revision 1 proposed reading `model_catalog.modalities` and defaulting an absent value to "assume
    vision". The catalog's own docstring says it "never gates selection; the runtime accepted set
    does" (`model_catalog.py:1-22`). The wire now carries
    `modelCapabilities: {inputModalities: [...]}` populated by the connection resolver, and an absent
    value means unknown, therefore workspace-only with the notice. Capabilities join
    `configFingerprint`.
12. **The dual read must watch today's real inline shape** (Codex "Dual-read rollout traps"). Revision
    1's legacy branch watched `type: "image"` with a `data` field. The browser writes the data URL
    into `FileUIPart.url` (`files.ts:21-33`), and `_part_to_blocks` copies `url` into
    `ContentBlock.uri` (`messages.py:97`), so the field the runner would have read is never sent. The
    dual read matches `uri` beginning `data:` first, and `data` as the historical fallback.
13. **Attachment mapping in the Vercel adapter is ingress-only** (Codex recommendation 3 → ruling R3).
    The module's symmetry rule has an explicit exception for a direction that cannot occur; the
    neutral attachment block carries no URL, so `_block_to_parts` cannot rebuild a `FileUIPart`. The
    docstring must state that, the way it already states the reasoning-part exception.
14. **`providerMetadata` is the carrier and it is verified available** (Codex recommendation 3 →
    ruling R3). `ai` is exact-pinned at `6.0.0-beta.150` and `FileUIPart` declares
    `providerMetadata?: ProviderMetadata` (`node_modules/ai/dist/index.d.ts:1602`). `url` keeps the
    real authenticated content URL; `providerMetadata.agenta.attachmentId` carries the id and is
    validated as a canonical UUID. The custom-scheme fallback is dropped.
15. **Route names are resource-shaped** (Codex layering → ruling "Route naming"). `POST
    /sessions/attachments` creates, `GET /sessions/attachments/{id}/content` returns bytes, `POST
    /sessions/attachments/reference` claims. The unrecognizable-bytes exception is `AttachmentInvalid`,
    not `AttachmentUnreadable`.
16. **Attachment routes use session-domain permissions only** (Codex security → ruling "Permissions").
    `SessionMountsRouter` requires both domains, but requiring `*_MOUNTS` on attachment routes leaks
    the storage implementation into the authorization model and can deny a legitimate session user.
    The deviation from the neighbouring router is deliberate and must be commented.
17. **The router does no domain work** (Codex layering → `api/AGENTS.md:93`). Revision 1 had the
    upload handler classify, create the mount, write the object, and insert the row. The router now
    parses and bounded-reads the `UploadFile`, checks access, calls `SessionAttachmentsService`, and
    maps domain exceptions. There is no private cross-domain `_write_attachment_original`; the
    attachments service reaches storage through a narrow public `AttachmentOriginalStore` operation on
    `MountsService`.
18. **The sweep deletes under a lock** (Codex recommendation 9 → ruling R9). `orphan_sweep.py` only
    writes DB and Redis state, so its "duplicates are harmless" property does not carry over to
    object-store deletion plus row hard-delete. The attachment sweep keeps the asyncio-lifespan
    mechanism but takes the Redis lock and re-checks `referenced_at` inside the deleting transaction.
19. **Filename safety is enforced independently at both ends** (Codex recommendation 10 → ruling R10).
    Revision 1 called re-reading `Content-Disposition` an independent check; it is another trust
    boundary. The runner validates the id as a canonical UUID, parses `filename*` per RFC 5987,
    sanitizes to a basename, enforces resolved-path containment under `cwd/attachments/`, rejects
    symlinks on every parent component, and writes create-exclusive.
20. **The migration's `down_revision` is `oss000000019`** (Codex layering → ruling "Migration").
    Revision 1 guessed from `oss000000016`. The head is
    `oss000000019_index_session_streams_archived_at.py`. The truncation-budget test moves to the
    session records tests, beside `unit/sessions/test_records_truncation.py`, not
    `unit/test_mounts_file_ops.py`.
21. **`puremagic` stays, behind an adapter, and is not a security boundary** (Codex recommendation 1 →
    ruling R1). Native image delivery maps explicitly to PNG, JPEG, GIF, and WebP; `image/svg+xml` is
    never a native image block.
22. **Stage 0 is already done.** Commit `f2aa193cb2` landed the paste and drag gating:
    `attachmentsBlocked` at `AgentConversation.tsx:1815` now begins with `!uploadsEnabled ||`. The
    uncommitted-edit question from revision 1 is closed. The stale doc comment at
    `assets/constants.ts:39-40` still claims paste is ungated and is now factually wrong; WP4 fixes it.

---

## Corrections to the design's code references

Use these values, not the ones in the design text.

- The single call that hands a turn to the harness is
  `services/runner/src/engines/sandbox_agent/run-turn.ts:803`
  (`env.session.prompt([{ type: "text", text: turnText }])`), not near line 742. `plan.md` says 742.
- The rejection of a text-free turn lives in
  `services/runner/src/engines/sandbox_agent/run-plan.ts:325`, not in `run-turn.ts`. The message is
  `"No user message to send (prompt/messages empty)."`.
- The `[image]` cold-replay placeholder is real
  (`services/runner/src/engines/sandbox_agent/transcript.ts:204-205`) but it fires only for a prior
  turn that still carries an image block in memory. A user turn rebuilt from durable records carries
  no image block at all, because `services/runner/src/sessions/reconstruct.ts:103-107` builds the
  user message from `event.text` alone. Both sites change.
- The design's "two integration gaps" section cites `protocol.ts` "near line 539" for capabilities and
  "near line 557" for the error string. `AgentRunResult` starts at line 539 and `error?: string` is
  line 557; both are still accurate.
- `design.md` states the count cap is "enforced at the run route". The run route is the runner's
  `/run`, and the runner cannot read `api/oss/src/utils/env.py`; the count is a runner-side config
  value (ruling R8).
- `plan.md` around line 120 states that a retried upload creates a new resource. Ruling A5 replaces
  that contract; the docs lane fixes the sentence (see "Design-doc sync").

---

## How Stage 1 splits into pull requests

Four stacked pull requests, merged bottom to top, plus a fifth act that is a configuration flip.
Merge order is deploy order. Each package is safe to deploy on its own because every package below it
is already live and every package above it does not exist yet.

| # | Branch | Scope | Base | Safe alone because |
| --- | --- | --- | --- | --- |
| WP1 | `wp1-api-attachments` | Attachment resource with `pending`/`ready` state, bounded create route, content route, claim route, protected-mount policy, `purpose` column, session quotas, sweep and reaper, nginx raise | workspace target | Adds routes nothing calls yet; the protected-mount policy closes a hole on a mount nothing creates yet. |
| WP2 | `wp2-runner-delivery` | `currentUserTurn` refactor first, then `protocol.ts` additions, dual read, capability gate, materialization, mentions, `attachment_delivery`, the claim call, records with references, cold-start sweep | WP1 | Consumer only. Nothing produces an attachment block, so the new paths are dead code until WP3. The `currentUserTurn` refactor and the dual read are live improvements on their own. |
| WP3 | `wp3-sdk-producer` | Attachment block ingress in the Vercel adapter, `modelCapabilities` on the wire, the delivery and error contract through `wire.py` and the Vercel stream, the new golden and both contract suites | WP2 | Produces blocks a live runner already understands. Requires a pip publish plus an agent-service deploy, which is why it is its own package. |
| WP4 | `wp4-frontend-transport` | Upload transport, references in parts, render through the content route, accept every kind with the notice, replay wiring, delivery-notice rendering | WP3 | Merged with `NEXT_PUBLIC_AGENT_FILE_UPLOADS` still off in production. |
| — | (no branch) | Turn the flag on | — | A configuration act, taken only after WP1, WP2, and WP3 are confirmed deployed. |

**Why the order is reader-first.** Codex's objection to revision 1 stands: the Vercel adapter is a
producer, and `ContentBlock.type` in `protocol.ts:13` is `... | string`, so an older runner accepts a
`type: "attachment"` block structurally and ignores it semantically — a silent file loss. Publishing
a pip package, deploying the agent service that imports it, and deploying the runner are three
separate rollout events. Consumers first makes every intermediate state degrade to today's behaviour
instead of losing data.

**The rollout matrix, after the corrections.**

| Frontend | SDK / agent service | Runner | Result |
| --- | --- | --- | --- |
| old | old | new | Works. The inline `data:` image now reaches the model, because WP2's dual read matches `uri: "data:..."` (the shape the browser actually sends). |
| old | new | new | Works, same path. |
| new | old | new | The reference is lost: `providerMetadata` is ignored and the SDK emits a resource with an HTTP `uri` and no bytes. This is why the flag stays off until WP3 is deployed. |
| new | new | old | The `attachment` block is structurally accepted and semantically ignored. Same reason. |
| new | new | new | The full path. |

A declared `attachments.v1` capability handshake would make the flag unnecessary. It is noted as
deferred hardening and is not built in Stage 1.

**If WP1 is too large to review**, split the sweep and reaper into `wp1b-attachment-sweep`. They are
operationally independent from the resource and must land before production enablement, not before
WP2.

**Where Stage 0 goes.** Nowhere. It is merged (`f2aa193cb2`). WP4 fixes the stale comment it left
behind at `assets/constants.ts:39-40`.

---

## Work package 1: the API attachment resource

The API stores an attachment original through a bounded, idempotent, two-phase create; serves it back
with a session-binding check; lets a caller claim it durably; and makes the attachments mount
invisible to every generic mount operation.

### The storage layout

The original lives in a session-scoped mount named `attachments`. Session mounts are an open
namespace: `MountsService.get_or_create_session_mount(project_id, user_id, session_id, name)`
(`api/oss/src/core/mounts/service.py:452`) mints the deterministic slug
`__ag__session__<uuid5(session_id)>__<name>` and upserts on `unique(project_id, slug)`, so calling it
with `name="attachments"` is idempotent and needs no enum or constant table. The object key is
`[<namespace>/]mounts/<project_id>/<mount_id>/<path>` (`_storage_key`, `service.py:405`).

The path inside the mount is `<attachment_id>/<filename>`. The id is minted when the `pending` row is
inserted, so no two uploads target the same key.

### New files

Core layer, following the existing session-facet shape (`core/sessions/{mounts,records,turns}/`):

- `api/oss/src/core/sessions/attachments/__init__.py`
- `api/oss/src/core/sessions/attachments/dtos.py`
- `api/oss/src/core/sessions/attachments/types.py` — domain exceptions
- `api/oss/src/core/sessions/attachments/interfaces.py` — `SessionAttachmentsDAOInterface`
- `api/oss/src/core/sessions/attachments/service.py` — `SessionAttachmentsService`
- `api/oss/src/core/sessions/attachments/media.py` — the classifier adapter

DB layer:

- `api/oss/src/dbs/postgres/sessions/attachments/{__init__,dbas,dbes,dao,mappings}.py`
- `api/oss/databases/postgres/migrations/core_oss/versions/oss000000020_add_session_attachments.py`,
  `revision = "oss000000020"`, `down_revision = "oss000000019"`

Background work:

- `api/oss/src/tasks/asyncio/sessions/attachment_sweep.py`, modelled on
  `api/oss/src/tasks/asyncio/sessions/orphan_sweep.py`

### Modified files

- `api/oss/src/apis/fastapi/sessions/router.py`: new `SessionAttachmentsRouter` beside
  `SessionMountsRouter` (class at line 872), constructed in `SessionsRouter.__init__` (class at line
  1394, `self.mounts = SessionMountsRouter(...)` at 1429). Mounted under the `/sessions` prefix, the
  same prefix the mounts sub-router uses.
- `api/oss/src/apis/fastapi/sessions/models.py`: request and response models (classes run from line
  29; `SessionMountsResponse` at 175 is the envelope precedent).
- `api/oss/src/core/mounts/service.py`: `ATTACHMENTS_MOUNT_NAME = "attachments"` beside
  `_SESSION_CWD_NAME` (line 56), `is_protected_mount()`, the `allow_protected` parameter on
  `_resolve_mount` (line 716), the filter in `query_mounts` (line 627), the name reservation in
  `get_or_create_session_mount` (line 452), and the narrow `AttachmentOriginalStore` operations.
- `api/oss/src/core/mounts/types.py`: `MountProtected` (the file's exceptions run to line 74;
  `MountImmutableField` at line 48 is a different thing and stays).
- `api/oss/src/core/mounts/dtos.py`: `purpose: Optional[str] = None` on `Mount` (line 25) and
  `MountCreate` (line 37). **Not** on `MountEdit` (line 46) and **not** in `MountFlags` (line 21),
  because flags are caller-supplied on create and editable through `MountEdit`.
- `api/oss/src/dbs/postgres/mounts/dbas.py`: `purpose = Column(String, nullable=True)` beside
  `session_id` and `agent_id`.
- `api/oss/src/dbs/postgres/mounts/mappings.py`: carry `purpose` both ways.
- `api/oss/src/apis/fastapi/mounts/router.py`: map `MountProtected` in `handle_mount_exceptions()`
  (line 64).
- `api/oss/src/utils/env.py`: `SessionsAttachmentsConfig` nested under `SessionsConfig` (line 507),
  declared with the file's own pattern.
- `api/entrypoints/routers.py`: DAO beside `mounts_dao` (line 561), service beside
  `session_mounts_service` (line 882), passed into `SessionsRouter` (line 1051), sweep task created
  in the lifespan beside `_orphan_sweep_task` (line 270) and cancelled at line 285.
- `api/pyproject.toml` and `api/uv.lock`: `cd api && uv add puremagic`.
- `hosting/docker-compose/oss/nginx/nginx.conf:35`: `client_max_body_size 10M;` becomes `32m`.

### The data contracts

Core DTOs, in `core/sessions/attachments/dtos.py`. Field roles: `id` is server-issued identity;
`project_id` and `session_id` are tenant and scope routing; `mount_id` and `path` are storage
coordinates that never leave the API (D10); `filename`, `media_type`, and `size` are verified
descriptors of the bytes; `state` and `referenced_at` are lifecycle; `idempotency_key` is a
client-supplied dedupe handle, never an identifier the client may use to fetch.

```python
class AttachmentState(str, Enum):
    PENDING = "pending"
    READY = "ready"


class Attachment(Identifier, Lifecycle):
    project_id: UUID
    session_id: str
    mount_id: UUID
    path: str                 # "<attachment_id>/<filename>", never in a response
    filename: str             # sanitized basename, server-authoritative
    media_type: str           # inspected from bytes, never the declared type
    size: int
    kind: AttachmentKind      # image | audio | document | other, derived from media_type
    state: AttachmentState
    idempotency_key: str
    referenced_at: Optional[datetime] = None
```

API models, in `apis/fastapi/sessions/models.py`:

```python
class SessionAttachment(BaseModel):
    attachment_id: UUID
    filename: str
    media_type: str
    size: int
    created_at: datetime


class SessionAttachmentResponse(BaseModel):
    count: int
    attachment: SessionAttachment


class SessionAttachmentReferenceRequest(BaseModel):
    session_id: str
    attachment_ids: List[UUID]


class SessionAttachmentsResponse(BaseModel):
    count: int
    attachments: List[SessionAttachment]
```

`mount_id`, `path`, `state`, and `idempotency_key` are absent from every response model.

### The routes

All three hang off the `/sessions` prefix. All three check a single session-domain permission and do
**not** require the mounts-domain permissions that `SessionMountsRouter._check` (line 936) requires,
per the ruling: a mounts permission on an attachment route exposes the storage implementation in the
authorization model and can deny a legitimate session user. Write a one-line comment at the check
saying so, or a later reviewer will "restore consistency" with the neighbouring router.

| Method | Path | operation_id | Permission | Input |
| --- | --- | --- | --- | --- |
| POST | `/attachments` | `create_session_attachment` | `EDIT_SESSIONS` | multipart `file`, form `idempotency_key`, query `session_id` |
| GET | `/attachments/{attachment_id}/content` | `download_session_attachment_content` | `VIEW_SESSIONS` | query `session_id` |
| POST | `/attachments/reference` | `reference_session_attachments` | `RUN_SESSIONS` | body `{session_id, attachment_ids}` |

`RUN_SESSIONS` on the claim route matches the runner-write family in the same file:
`ingest_record_event` (line 529), `append_turn` (line 1134), and the heartbeat (line 270) all use it.
The browser never calls the claim route.

**Create, step by step.** The router validates `session_id` with `_validate_session_id_http`
(line 138), checks `EDIT_SESSIONS`, performs the bounded read, and hands bytes plus metadata to
`SessionAttachmentsService.create_attachment(...)`. Everything below the read is service work.

1. **Bounded read.** Accumulate `await file.read(65536)` chunks until the total exceeds
   `max_raw_cap + 1` bytes, where `max_raw_cap` is the largest per-kind cap (15 MB). Over that, stop
   reading and raise `AttachmentTooLarge` → 413. This is the only thing standing between an arbitrary
   body and API memory on the EE stack, which runs Traefik with no buffering middleware and no body
   cap, behind uvicorn, which has no body limit either. Do **not** copy `await file.read()` from
   `apis/fastapi/mounts/utils.py:85`.
2. **Classify** through `media.classify(...)` and apply the lower per-kind cap. Unrecognizable or
   empty bytes raise `AttachmentInvalid` → 422; over the per-kind cap raises `AttachmentTooLarge` →
   413.
3. **Sanitize the filename** to a basename: strip every path separator, reject `..`, reject control
   characters, fall back to `attachment`.
4. **Quota check** against the session: ready-or-referenced count and byte total, and pending count.
   Over any of them raises `AttachmentQuotaExceeded` → 429 with a detail naming which quota.
5. **Get or create the attachments mount**, passing `purpose="session_attachment_originals"`.
6. **Insert the `pending` row** with a fresh uuid7 id, unique on `(project_id, session_id,
   idempotency_key)`. On conflict: a `ready` row for the same key is returned as-is (idempotent
   success); a fresh `pending` row raises `AttachmentUploadInFlight` → 409; a `pending` row older
   than the pending time-to-live is taken over.
7. **Write the object** through the narrow `MountsService` attachment-original operation, which is
   the only writer that bypasses the protected-mount policy.
8. **Mark the row `ready`.** If this fails the row stays `pending` and the reaper removes the row and
   the object. Nothing is ever visible half-written, because reads resolve only `ready`.
9. Return `{count: 1, attachment: {...}}`.

`ObjectStore.put_object` (`api/oss/src/core/store/storage.py:439`) is unconditional and the store
exposes no head-object call, so create-only cannot come from the storage layer. The `pending` → `ready`
row is what provides it: the id is unique per row, so a second writer at the same key cannot exist.

**Content**, `GET /attachments/{attachment_id}/content`. Resolve the row by
`(project_id, attachment_id)`; return 404 when the row is missing, when `state != ready`, or when
`row.session_id` differs from the `session_id` query parameter. One 404 for all three, with a body
that names no other session. The response reuses `_content_disposition_attachment` and
`BINARY_RESPONSE` from `apis/fastapi/mounts/utils.py` (lines 46 and 35) but sets `media_type` from the
stored verified type rather than `guess_type(name)`, and adds `X-Content-Type-Options: nosniff`. The
route has no side effects.

**Reference**, `POST /attachments/reference`. Resolve every id under one transaction with
`SELECT ... FOR UPDATE`, apply the same 404 rules as the content route (missing, not ready, or wrong
session, all indistinguishable), set `referenced_at = now()` where it is null, and return the
attachments. Holding the row lock is what serializes the claim against the sweep.

### The protected-mount policy (decisions D3 and D7)

The generic mounts routes reach any mount in the project by id, and none of them asks what kind of
mount it is. `MountsRouter` (`api/oss/src/apis/fastapi/mounts/router.py:131`) exposes `create_mount`,
`query_mounts`, `fetch_mount`, `edit_mount`, `sign_mount_credentials`, `export_mount_files`,
`archive_mount`, `unarchive_mount`, `create_mount_folder`, `upload_mount_file`, `download_mount_file`,
`get_mount_files`, `write_mount_file`, and `delete_mount_file`. `SessionMountsRouter` adds
`fetch_session_mounts`, `query_session_mounts`, `sign_session_mount_credentials`,
`upload_session_mount_file`, and `download_session_mount_file`. Revision 1 guarded four of these.

Put one policy in `api/oss/src/core/mounts/service.py` so every route inherits it:

```python
ATTACHMENTS_MOUNT_NAME = "attachments"
ATTACHMENTS_MOUNT_PURPOSE = "session_attachment_originals"


def is_protected_mount(mount: Mount) -> bool:
    """A server-owned mount generic mount operations must not see.

    `purpose` is the durable classification; the slug check is the transitional fallback for
    rows written before the column existed.
    """
    if mount.purpose == ATTACHMENTS_MOUNT_PURPOSE:
        return True
    if not mount.session_id:
        return False
    return mount.slug == mint_session_slug(
        session_id=mount.session_id, name=ATTACHMENTS_MOUNT_NAME
    )
```

Apply it at three seams:

- **`_resolve_mount` (line 716)** gains `allow_protected: bool = False` and raises `MountProtected`
  when the resolved mount is protected and the caller did not opt in. Every by-id operation goes
  through it: `edit_mount` (578), `archive_mount` (599), `unarchive_mount` (613),
  `sign_mount_credentials` (735), `list_files` (921), `read_file_bytes` (1224),
  `build_archive_work_list` (1238), `iter_archive_members` (1305), `read_file` (1340), `write_file`
  (1355), `create_folder` (1374), and `delete_path` (1395). `fetch_mount` (552) and `fetch_agent_mount`
  (564) return `None` for a protected mount.
- **`query_mounts` (line 627)** filters protected mounts out of the result. This is *listing* only.
  `delete_session_mounts` (642) and `archive_session_mounts` (665) must keep including them, because
  they are the session-lifecycle owner and the retention rule under "Settled by evidence" in
  `decisions.md` depends on them. Write that in a comment; a future reader will otherwise "fix" the
  inconsistency and break teardown.
- **`get_or_create_session_mount` (line 452)** gains `purpose: Optional[str] = None` and raises
  `MountNameInvalid` when `purpose is None` and `slugify_mount_name(name)` equals
  `ATTACHMENTS_MOUNT_NAME`, so a generic caller cannot create or reach the mount by name.

`handle_mount_exceptions()` (`apis/fastapi/mounts/router.py:64`) maps `MountProtected` to **404** with
the same detail text `MountNotFound` uses. The wire is then indistinguishable from a mount that does
not exist, which is what the ruling requires; the named exception survives for logging and for tests
that must tell the two apart.

Refusing to sign is the second half of D7: `sign_mount_credentials` (line 735) has no read-only
variant, so signing the attachments mount at all would hand out write access.

### Media classification (the matrix)

`core/sessions/attachments/media.py` implements the three rules from `design.md`, "How the server
classifies a file", behind a one-function library seam so `puremagic` can be swapped without touching
policy:

```python
def _sniff(data: bytes) -> Optional[str]:
    """The only puremagic call. Pinned; classification is not a security boundary."""
```

1. Known signature: store the inspected type. The declared type never wins, and the mismatch is
   silent.
2. No signature but valid UTF-8: store as text. Keep the declared type when it is a `text/*` subtype
   or `application/json`; otherwise store `text/plain`.
3. No signature, not valid UTF-8, or zero bytes: raise `AttachmentInvalid` → 422.

`kind` derives from the stored type: `image`, `audio`, `document`, `other`. A separate
`native_image: bool` is true only for `image/png`, `image/jpeg`, `image/gif`, and `image/webp` — the
matrix's native image row. `image/svg+xml` is XML text: it classifies as `document` and is never a
native image block. Per-kind caps: 10 MB image, 15 MB audio, 10 MB document, 10 MB other. A recognized
type that is not a native kind is never rejected (D6).

### Environment variables

All in `api/oss/src/utils/env.py`, consumed through the shared `env` object. Never `os.getenv` in
feature code.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENTA_ATTACHMENTS_MAX_IMAGE_BYTES` | 10485760 | Per-file image cap |
| `AGENTA_ATTACHMENTS_MAX_AUDIO_BYTES` | 15728640 | Per-file audio cap |
| `AGENTA_ATTACHMENTS_MAX_DOCUMENT_BYTES` | 10485760 | Per-file document cap |
| `AGENTA_ATTACHMENTS_MAX_OTHER_BYTES` | 10485760 | Per-file cap for every other recognized kind |
| `AGENTA_ATTACHMENTS_MAX_PER_SESSION_COUNT` | 100 | Session quota, ready plus referenced |
| `AGENTA_ATTACHMENTS_MAX_PER_SESSION_BYTES` | 268435456 | Session quota, 256 MB |
| `AGENTA_ATTACHMENTS_MAX_PENDING_PER_SESSION` | 20 | Concurrent unfinished uploads |
| `AGENTA_ATTACHMENTS_PENDING_TTL_SECONDS` | 900 | Age at which a stuck pending row is reaped |
| `AGENTA_ATTACHMENTS_UNREFERENCED_TTL_SECONDS` | 86400 | Age at which an unclaimed ready upload is swept |
| `AGENTA_ATTACHMENTS_SWEEP_INTERVAL_SECONDS` | 3600 | Sweep period |

The per-message count cap is **not** here. It lives in the runner (ruling R8).

### The record-schema extension

No migration. A record's payload is a JSONB column
(`api/oss/src/dbs/postgres/sessions/records/dbas.py:64`) holding whatever the producer sends, and the
API never inspects its shape; the runner posts `attributes: event` verbatim
(`services/runner/src/sessions/persist.ts:104`). So the schema change is entirely a WP2 change: the
existing `{ type: "message", text }` event gains an optional `attachments` array, and the new
`attachment_delivery` event is a new record type. WP1's only obligation is to confirm the truncation
budget tolerates it. `MAX_ATTRIBUTES_BYTES` is 64 KB
(`api/oss/src/core/sessions/records/streaming.py:23`) and five references plus five delivery events
are well under a kilobyte. Pin it with a test rather than by inspection.

### The sweep and the reaper

`attachment_sweep.py` mirrors `orphan_sweep.py`: a single-pass `run_attachment_sweep(engine,
lock_engine)` plus an `attachment_sweep_loop` started with `asyncio.create_task` in the lifespan
(`entrypoints/routers.py:270`) and cancelled at shutdown (line 285). Each pass does two things, both
under the Redis lock:

- **Reaper.** `state = pending AND created_at < now - pending_ttl` → delete the object key
  best-effort, then delete the row. This is the compensation for a create that died between the object
  write and the `ready` transition.
- **Sweep.** `state = ready AND referenced_at IS NULL AND created_at < now - unreferenced_ttl` →
  delete objects, delete rows.

Both select `FOR UPDATE SKIP LOCKED` and re-check `referenced_at IS NULL` inside the deleting
transaction, so a claim in flight always wins. `orphan_sweep.py` runs unlocked because it only writes
DB and Redis state; hard-deleting object keys from several replicas is not idempotent in the same way,
which is why this one takes the lock.

Accepted edge for v1 (ruling A4): a message sent while the runner is down past the unreferenced
time-to-live leaves a broken reference. Twenty-four hours makes it rare, and Stage 3's reference
counting against the records replaces the mechanism.

### Tests

Conventions in `docs/designs/testing/README.md`. API tests live under `api/oss/tests/pytest/` split
into `unit/`, `integration/`, and `acceptance/`; acceptance tests mint ephemeral accounts through the
`authed_api` fixture built on `cls_account` (`api/oss/tests/pytest/utils/api.py`, `utils/accounts.py`).

New:

- `unit/sessions/test_attachment_media.py` — the classifier corpus. A PNG declared `text/plain` stores
  `image/png`. A Markdown file with no signature stores `text/markdown`. A CSV declared
  `application/octet-stream` stores `text/plain`. Random non-UTF-8 bytes raise `AttachmentInvalid`. A
  zero-byte file raises `AttachmentInvalid`. A ZIP is accepted as `other`, not rejected. An SVG
  classifies as `document` with `native_image` false.
- `unit/sessions/test_attachment_filename.py` — `../../etc/passwd` sanitizes to `passwd`; a bare `..`
  falls back to `attachment`; a filename with a NUL or a newline is rejected.
- `unit/sessions/test_attachment_state_machine.py` — a create that fails after the object write leaves
  a `pending` row; a download of a `pending` row is 404; the same idempotency key returns the same
  `ready` attachment; a second key for the same bytes creates a second attachment (no deduplication,
  per `scope.md`).
- `unit/sessions/test_attachment_quotas.py` — the count, byte, and pending quotas each reject at the
  boundary and admit one under it.
- `unit/sessions/test_attachment_sweep.py` — an unclaimed `ready` attachment older than the
  time-to-live is swept; a claimed one of the same age is not; a fresh one is not; a stale `pending`
  row is reaped with its object; a row claimed between the select and the delete survives.
- `unit/mounts/test_protected_mount_policy.py` — for an attachments mount: `fetch_mount` returns
  `None`; `query_mounts` omits it; `edit_mount`, `archive_mount`, `unarchive_mount`, `list_files`,
  `read_file`, `read_file_bytes`, `build_archive_work_list`, `write_file`, `create_folder`,
  `delete_path`, and `sign_mount_credentials` each raise `MountProtected`; every one of them succeeds
  against a `cwd` mount. `get_or_create_session_mount(name="attachments")` without a purpose raises
  `MountNameInvalid`. `delete_session_mounts` and `archive_session_mounts` still include it.
- `acceptance/sessions/test_session_attachments.py` — create returns the resource with no storage
  coordinates; the content route returns byte-identical content and the verified `Content-Type` plus
  `nosniff`; a content request naming a different `session_id` returns 404; a random uuid returns 404;
  an over-cap image returns 413 with a structured body; the claim route sets `referenced_at` and
  returns 404 for a foreign attachment; the content route leaves `referenced_at` untouched.
- `acceptance/mounts/test_attachments_mount_hidden.py` — every generic mounts route named above
  returns 404 for the attachments mount id, and the mount does not appear in
  `fetch_session_mounts` or `query_session_mounts`.
- `acceptance/sessions/test_session_attachment_teardown.py` — deleting the session removes the
  attachments mount and its objects; archiving keeps them. `plan.md` lists this as Stage 3, but it is
  one assertion over machinery WP1 creates and it pins the retention rule while the code is fresh.

Extend:

- `unit/sessions/test_records_truncation.py` — assert the truncation budget tolerates a payload
  carrying five attachment references plus five delivery events. (Ruling: this belongs with the
  records tests, not `unit/test_mounts_file_ops.py`.)

Run with `cd api && py-run-tests`.

### Acceptance criteria

- `POST /sessions/attachments` returns
  `{count, attachment: {attachment_id, filename, media_type, size, created_at}}` and no storage
  coordinates.
- The stored `media_type` comes from the bytes. A lying client cannot change it.
- A body larger than the maximum raw cap is refused without the API ever holding it all.
- Re-posting with the same idempotency key returns the same attachment, and no second object exists.
- A create interrupted after the object write leaves nothing reachable, and the reaper removes both
  halves.
- `GET /sessions/attachments/{id}/content` with a mismatched `session_id` returns 404, and the body
  names no other session. The route sets nothing.
- `POST /sessions/attachments/reference` is the only thing that sets `referenced_at`.
- Every generic mount route returns 404 for the attachments mount id, and the mount is absent from
  every mount listing. Session teardown still removes it.
- The session quotas reject at their boundaries.
- `client_max_body_size` is `32m` in the compose nginx config and a 15 MB audio upload succeeds through
  the `with-nginx` profile.
- `ruff format` and `ruff check` pass from `api/`.

---

## Work package 2: the runner as consumer

The runner learns what the current user turn is, then resolves references through the API, claims
them, writes working copies, builds real ACP blocks, gates on the three-layer intersection, reports
the outcome structurally, and represents historical attachments as mentions.

### First commit: `currentUserTurn`

Nothing else in this package is written until this lands, because the happy-path image test can pass
while attachment-only turns, cold reconstruction, warm continuation, and records all fail differently.

Add to `services/runner/src/protocol.ts`, beside `resolvePromptText` (line 585):

```ts
export interface AttachmentRef {
  attachmentId: string;
  filename?: string;
  mediaType?: string;
  size?: number;
}

export interface CurrentUserTurn {
  /** The tail message when it is a user turn, else null. Never an earlier message. */
  message: ChatMessage | null;
  text: string;
  attachments: AttachmentRef[];
  /** A genuinely new user turn: role user, carrying no tool envelope. */
  isFresh: boolean;
  carriesToolEnvelope: boolean;
}

export function currentUserTurn(request: AgentRunRequest): CurrentUserTurn;
```

It reads the **tail only**. `resolvePromptText`'s backward scan stays, because the approval-resume
path genuinely wants the original prompt (`run-turn.ts:161` and `transcript.ts:233` both document
that), but its doc comment must be rewritten to say it is the approval-resume fallback and not "the
current turn". The four sites Codex found:

- `run-plan.ts:319-330`: the empty-prompt rejection becomes
  `if (!turn.text && turn.attachments.length === 0 && !carriesApprovalReplyOnly(request))`. An
  attachment-only turn is now valid.
- `session-identity.ts:344` `tailIsFreshUserMessage`: reimplement over `currentUserTurn` as
  `turn.isFresh && (turn.text.trim() !== "" || turn.attachments.length > 0)`. The existing
  tool-envelope check moves into `currentUserTurn`.
- `session-identity.ts:213` `historyFingerprint`: hash ordered attachment ids per user message
  alongside `userTexts`, so two turns differing only in their attachments no longer collide. Note
  the one-time cost: adding a field to the canonical JSON changes every hash, so every parked session
  mismatches once on the deploy and cold-starts. The pool is in-process, so this already happens on
  every runner deploy.
- `server.ts:1082-1084`: persist becomes
  `persist({ type: "message", text: turn.text, attachments: turn.attachments }, "user")`, guarded on
  `tailIsFreshUserMessage(request)` as today. The guard's reason (an approval resume must not
  re-persist the original prompt) is unchanged and its comment at 1078-1081 stays accurate.
- `run-turn.ts:188`: `promptText` uses `turn.text` on the fresh path and keeps `resolvePromptText` on
  the approval-resume path, matching the branch already there at 194-200.

`configFingerprint` (`session-identity.ts:143`) also gains `request.modelCapabilities`, per ruling R2,
so a model-capability change evicts a parked session rather than silently reusing a stale gate.

Tests: extend `tests/unit/session-continuity.test.ts` and `tests/unit/session-persist.test.ts`; add
`tests/unit/current-user-turn.test.ts` covering an attachment-only tail after a text turn (the exact
bug), an approval-resume tail, a tool-envelope tail, and an empty conversation.

### `protocol.ts` additions

- `ContentBlock` (line 12): `"attachment"` joins the type union; add `attachmentId?: string`,
  `filename?: string`, `size?: number`. `mimeType` and `uri` already exist.
- `AgentEvent` (line 325): the `message` variant gains `attachments?: AttachmentRef[]`, and a new
  member is added:

  ```ts
  | {
      type: "attachment_delivery";
      attachmentId: string;
      outcome: "native" | "workspace_only" | "failed";
      /** Stable string code, never a display string. */
      reasonCode: string;
      workingPath?: string;
    }
  ```
- `AgentRunRequest` (line 404) gains `modelCapabilities?: { inputModalities?: string[] }`, and the
  key is added to `KNOWN_REQUEST_KEYS` in `tests/unit/wire-contract.test.ts:34-68`. That array is
  typed `(keyof AgentRunRequest)[]`, so `tsc` forces the two to agree in this package.

**This is the one place the runner's own rule bends.** `services/runner/CLAUDE.md` says a wire change
updates the golden, then `protocol.ts`, then `wire.py`, then both contract tests, deliberately.
Reader-first deploy order splits that across WP2 (TS types plus the key list) and WP3 (`wire.py`, the
new golden, both suites). The existing goldens stay byte-identical after WP2 because every added field
is optional, so both suites keep passing. Note it in the WP2 pull-request body so it is a decision, not
a drift.

### New files

- `services/runner/src/sessions/attachments.ts` — the API client, mirroring
  `services/runner/src/sessions/records-query.ts`: same `apiBase()` (`src/apiBase.ts:20`), same
  `authorization: auth()` run credential (`runtime-policy.ts:11`), same `envTimerMs` bounded timeout
  (`src/env.ts:110`), same return-null-on-failure discipline and stderr logging.
  - `fetchAttachment(sessionId, attachmentId, auth)` → `GET ${apiBase()}/sessions/attachments/
    ${attachmentId}/content?session_id=...`, returning
    `{ bytes: Uint8Array, mediaType: string, filename: string } | null`, with `mediaType` from
    `Content-Type` and `filename` parsed from `Content-Disposition` (`filename*` per RFC 5987 first,
    quoted `filename` second) and sanitized to a basename.
  - `claimAttachments(sessionId, attachmentIds, auth)` → `POST ${apiBase()}/sessions/attachments/
    reference`, returning a boolean. A failed claim is logged and **non-fatal**: the turn still runs,
    because the download path is independent; the only loss is durability, which the sweep's
    24-hour window makes recoverable by re-sending.
- `services/runner/src/engines/sandbox_agent/attachments.ts` — the delivery logic.
  - `collectAttachmentRefs(message)` — `type: "attachment"` blocks on one message.
  - `collectLegacyInlineImages(message)` — the dual read. Matches `type: "image"` with `uri`
    beginning `data:` **first** (today's real shape: the browser writes the data URL into
    `FileUIPart.url` at `files.ts:21-33`, and `_part_to_blocks` copies `url` into `ContentBlock.uri`
    at `messages.py:97`), then `type: "image"` with a `data` field as the historical fallback.
    Revision 1 watched only the second and would have missed every file the product sends today.
  - `attachmentWorkingPath(cwd, ref)` — the single place the path convention lives, used by
    materialization, the mention, and the delivery event so they cannot drift. Validates
    `attachmentId` as a canonical UUID **before** any path construction, requires `filename` to be a
    basename with no separator, `.`, `..`, or control character, then resolves and asserts containment
    under `${cwd}/attachments/`.
  - `attachmentMention(ref)` — `[attached file: <filename> at attachments/<id>/<filename>]`. One
    formatter, shared with `transcript.ts`.
  - `materializeWorkingCopy(sandbox, plan, ref, bytes)` — never overwrites.
    - Local: `mkdirSync(dir, { recursive: true })`, `lstatSync` every component under
      `${cwd}/attachments` rejecting any symlink, then `writeFileSync(tmp, buf, { flag: "wx" })`
      followed by `linkSync(tmp, final)` and `unlinkSync(tmp)`. `link` fails `EEXIST` when the final
      path exists, which gives never-overwrite and atomic publish in one primitive; `rename` would
      clobber and `existsSync` then `writeFileSync` is the TOCTOU Codex flagged.
    - Daytona: `sandbox.statFs({ path })` as the existence check, `sandbox.mkdirFs` for the parent,
      then `sandbox.writeFsFile({ path }, buffer)` — `writeFsFile(query, body: BodyInit)` takes a
      Buffer, so no base64 shell decode. The same calls `prepareWorkspace` already uses
      (`workspace.ts:64-95`). The Daytona filesystem API exposes no exclusive create, so the
      check-then-write race remains; it is accepted and must be commented, because the alternative is
      a shell round trip per file.
  - `buildPromptBlocks(turnText, resolved, gate)` — native blocks first, then **exactly one** text
    block whose content is the mention lines followed by the user text. An attachment-only turn
    therefore has a non-empty prompt.
  - `restoreReferencedWorkingCopies(...)` — the cold-start sweep, with concurrency 4 and a per-file
    timeout, both from runner config.

### Modified files

- `run-turn.ts:803` — `env.session.prompt(promptBlocks)` instead of the literal single-element array.
  Resolution happens above, after `turnText` is computed at lines 188-200, so it sees the
  reconstructed request.
- `run-plan.ts:319-330` — the `currentUserTurn` condition described above.
- `transcript.ts:204-205` — an `attachment` block renders as `attachmentMention(...)`. Keep the
  `[image]` branch for legacy inline blocks so a mixed-version rollout degrades the way it does today.
- `sessions/reconstruct.ts:103-107` — the user branch. When `attributes.attachments` is present, build
  `content` as a block array (attachment blocks plus a text block) instead of a plain string.
  `eventToBlock` (line 44) keeps its default-drop behaviour; only the user branch changes.
- `engines/sandbox_agent/reconstruct-history.ts` — after `reconstructMessages` (line 109), sweep
  every attachment reference in the rebuilt conversation and restore missing working copies with
  bounded concurrency. Never overwrite.
- `server.ts:1082-1084` — persist the user record with its references, then call `claimAttachments`
  before the engine runs. Order matters: claim after validating the current turn, before execution, per
  ruling A4.
- `engines/sandbox_agent/capabilities.ts` — the gate, below.

### The three-layer capability gate (decision D5)

- **Layer one, ACP transport.** Already probed: `mapCapabilities` reads `c.images` (line 86) with a
  static fallback of `images: false` (line 105). Nothing reads it today; this package is the first
  reader, and the static fallback's `false` is already the safe default.
- **Layer two, adapter fidelity.** A static table keyed on `plan.acpAgent`, pinned to the adapter
  versions in `services/runner/package.json`: `@agentclientprotocol/claude-agent-acp` 0.58.1 and
  `pi-acp` 0.0.29, the latter also carrying the local `patches/pi-acp@0.0.29.patch`. From
  `research.md` section 4: both adapters deliver an image natively; neither delivers audio; Claude
  drops a document blob and Pi renders it as a byte count. Put the version pins in a comment beside
  the table so a bump forces a re-read.
- **Layer three, model modalities.** `request.modelCapabilities?.inputModalities`. **Absent, empty, or
  unrecognized means unknown, and unknown means workspace-only with the notice** (ruling R2). Never
  "assume vision". This is strictly better than today, where an unperceived image is silently
  flattened, and it is never silently wrong.

The gate returns one outcome per attachment: `native`, `workspace_only`, or `failed`. `failed` fires
only on a contract violation, meaning the request explicitly asked for a native block the transport
never advertised. Add `attachmentDeliveryUnsupportedMessage(harness, kind, missing)` beside
`toolDeliveryUnsupportedMessage` (`capabilities.ts:51`), thrown from the resolution step and caught by
`run-turn.ts`'s existing handler at line 1004, which already turns a throw into `{ ok: false, error }`.

The oversized-original rule belongs here: an image whose base64 length would exceed the selected
provider's per-image cap (about 7.5 MB raw on Claude) is `workspace_only` with reason code
`provider_inline_cap`, never resized and never a failed turn.

Every outcome emits an `attachment_delivery` event through the persisting emitter, so it lands in the
records and replays on reload. Reason codes are stable strings, at minimum:
`transport_unsupported`, `adapter_unsupported`, `model_modality_unknown`,
`model_modality_unsupported`, `provider_inline_cap`, `fetch_failed`, `contract_violation`.

### Count enforcement and runner config

The count is enforced in the runner (ruling R8), over `currentUserTurn(request).attachments`, **before
any download**. The runner cannot read `api/oss/src/utils/env.py`, so it carries its own values through
`envInt` / `envTimerMs` (`src/env.ts:58` and `110`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENTA_ATTACHMENTS_MAX_PER_TURN` | 5 | Count cap for the current turn |
| `AGENTA_ATTACHMENTS_FETCH_TIMEOUT_MS` | 15000 | Per-download bound |
| `AGENTA_ATTACHMENTS_RESTORE_CONCURRENCY` | 4 | Cold-start restore parallelism |
| `AGENTA_ATTACHMENTS_RESTORE_TIMEOUT_MS` | 15000 | Per-file restore bound |

### Tests

Vitest, `services/runner/tests/unit/**`, run with `pnpm test` from `services/runner`.

New:

- `tests/unit/current-user-turn.test.ts` — as above. This is the regression pin for Codex's single
  most likely implementation bite.
- `tests/unit/attachment-client.test.ts` — a 404 returns null and does not throw; a timeout returns
  null; the media type comes from `Content-Type`; `filename*` is parsed per RFC 5987 and sanitized to a
  basename; a claim failure is non-fatal.
- `tests/unit/attachment-path-safety.test.ts` — a non-UUID `attachmentId` is rejected before any path
  is built; a filename containing `/` or `..` is rejected; a symlinked parent component is rejected; a
  resolved path outside `cwd/attachments` is rejected.
- `tests/unit/attachment-materialize.test.ts` — a missing working copy is written; an existing one is
  never overwritten (the `link` returns `EEXIST` and the turn continues); two attachments sharing a
  filename land at different paths; local and Daytona write identical bytes.
- `tests/unit/attachment-capability-gate.test.ts` — images are native on both adapters when
  `inputModalities` includes `image`; **absent `modelCapabilities` yields workspace_only, not native**;
  audio never delivers natively; a document is workspace-only on both adapters; an explicit request for
  an unadvertised native block fails the turn with the structured message; an oversized image is
  workspace-only with `provider_inline_cap`.
- `tests/unit/attachment-prompt-blocks.test.ts` — an image-and-text turn produces an image block and
  one text block; an attachment-only turn produces one native block and a text block containing only
  the mention; a workspace-only attachment produces no native block, a mention, and a running turn.
- `tests/unit/attachment-delivery-events.test.ts` — one `attachment_delivery` event per current-turn
  attachment, with the working path and a stable reason code, persisted through the emitter.

Extend:

- `tests/unit/sandbox-agent-orchestration.test.ts:376` — the assertion
  `assert.deepEqual(calls.promptBlocks, [{ type: "text", text: "hello" }])` changes, and gains a
  multi-block case.
- `tests/unit/transcript.test.ts` — a past attachment renders as the mention with the real filename and
  working-copy path, not `[image]`.
- `tests/unit/session-reconstruct.test.ts` — a user record with attachments rebuilds a turn carrying
  attachment blocks.
- `tests/unit/session-reconstruct-history.test.ts` — the cold-start sweep restores every missing
  working copy, skips the present ones, and respects the concurrency bound.
- `tests/unit/sandbox-agent-capabilities.test.ts` — the static adapter-fidelity table and its version
  pins.
- `tests/unit/session-continuity.test.ts` and `tests/unit/session-persist.test.ts` — the fingerprint and
  persistence changes.
- `tests/unit/wire-contract.test.ts` — `modelCapabilities` in `KNOWN_REQUEST_KEYS`; existing goldens
  unchanged.

Also run the live check `plan.md` asks for: an integration run against both pinned adapters confirming
an inline image reaches the model as a real image. The `agent-release-gate` skill is the existing
wire-level harness for that.

### Acceptance criteria

- An attachment-only turn after an earlier text turn sends the attachment and **not** the earlier text.
- An image-and-text turn reaches the harness as a native block plus one text block.
- An image-only turn runs instead of failing with "No user message to send".
- Every current-turn attachment appears as a mention line in the text block, with the real path.
- The working copy exists at `cwd/attachments/<attachment_id>/<filename>` after the turn, and an agent
  edit to it survives the next turn.
- A cold replay emits the mention with the real filename and path, and every mentioned path exists
  after the bounded sweep.
- A reference to another session's attachment fails the turn with a message naming neither the other
  session nor a storage path.
- With `modelCapabilities` absent, an image is delivered workspace-only with the notice, not natively.
- A turn carrying a document runs, delivers it workspace-only, and emits `attachment_delivery` saying
  so.
- A pasted screenshot from today's frontend still reaches the model (the `uri: "data:..."` dual read).
- `pnpm test` and `pnpm run typecheck` pass from `services/runner`.

---

## Work package 3: the SDK and agent-service producer

One new content-block form travels from the browser through the SDK to the runner, the resolved
connection puts the model's input modalities on the wire, and the delivery outcome travels back.

### The attachment block

```jsonc
{
  "type": "attachment",
  "attachmentId": "0199...",   // server-issued, opaque, the only field the runner acts on
  "filename": "photo.png",     // display; the runner re-reads the authoritative value on download
  "mimeType": "image/png",     // display; same
  "size": 482113               // display
}
```

Field roles: `attachmentId` is a routing handle naming a resource the API owns, and it is the one
field with authority. `filename`, `mimeType`, and `size` are descriptors the frontend already has and
would otherwise re-fetch to render a chip. They travel for display only. The runner takes the
authoritative filename and media type from the content response headers, never from the wire, because
the wire is something a client writes. Write that as a comment in the runner code or a later change
will quietly start trusting the wire values.

Naming: the wire uses camelCase because `ContentBlock.to_wire()` already emits `mimeType` and
`toolCallId` (`sdks/python/agenta/sdk/agents/dtos.py:256-276`), while the API's JSON uses snake_case
(`media_type`). That split is the existing convention, not a mistake. `type: "attachment"` is a new
value rather than a reuse of `"resource"`, because `resource` already means an embedded resource
carrying bytes.

### Files

- `sdks/python/agenta/sdk/agents/dtos.py` — `ContentBlock` (class at line 229, fields at 244-254)
  gains `attachment_id`, `filename`, and `size`. `mime_type` exists (line 247); `filename` does
  **not** exist anywhere in the Python wire model today, so a browser file part's filename currently
  has no carrier at all. Extend `to_wire()` (256-276) and `from_raw()` (278-300).
- `sdks/python/agenta/sdk/agents/wire_models.py` — `WireContentBlock` (line 86, fields 89-98) gains the
  same three with aliases.
- `sdks/python/agenta/sdk/agents/adapters/vercel/messages.py` — `_part_to_blocks` (line 66): a `file`
  part whose `providerMetadata.agenta.attachmentId` parses as a canonical UUID becomes an
  `attachment` block carrying `filename`, `mimeType`, and `size`. A `file` part without it keeps
  today's behaviour exactly (lines 97-110), which is what makes the old-frontend path keep working.
  `_block_to_parts` (line 292) is **not** extended: attachment mapping is ingress-only, because the
  neutral block carries no URL and the module cannot rebuild a `FileUIPart` from it. State that in the
  docstring the way it already states the reasoning-part exception (lines 76-88).
- `sdks/python/agenta/sdk/agents/connections/models.py` — `ResolvedConnection` (line 162, fields
  176-182) gains `input_modalities: Optional[List[str]] = None`, and `to_wire()` (190-207) emits
  `modelCapabilities: {"inputModalities": [...]}` when it is set and omits it entirely when it is not.
  This is the resolved model and connection boundary, reached through
  `HarnessAgentTemplate.wire_resolved_connection()` (`dtos.py:825-838`) and spread into the payload by
  `request_to_wire` (`utils/wire.py:82`, model fields at 148-149).
- `sdks/python/agenta/sdk/agents/connections/resolver.py` and
  `sdks/python/agenta/sdk/agents/platform/connections.py` — populate `input_modalities` at each
  `ResolvedConnection(...)` construction site (`resolver.py:58, 75, 82, 137`;
  `platform/connections.py:504, 531`). The value may be looked up in `model_catalog` — that is where
  the fact lives (`model_catalog.py:75`, backed by `data/*.json`) — but the resolver owns it on the
  wire, and a lookup miss leaves the field `None` rather than guessing. The catalog stays what its
  docstring says it is: decoration that never gates.
- `sdks/python/agenta/sdk/agents/utils/wire.py` — `result_from_wire` (line 162). Today lines 169-172
  raise `RuntimeError` before touching any other field, discarding `messages`, `events`, `output`,
  `usage`, `stopReason`, and `capabilities`. Change to raise a typed `AgentRunFailed(RuntimeError)`
  carrying a stable `code` and the sanitized message, and on the success path parse
  `attachment_delivery` events into `AgentResult`.
- `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py` — project `attachment_delivery` onto the
  Vercel stream as a `data-attachment-delivery` part, matching the existing one-way `data` →
  `data-<name>` projection (`protocol.ts:376-378`). Both twins need it:
  `_agent_run_to_vercel_parts_impl` (line 113, runner-event branch at 309-311) and
  `_agent_stream_to_vercel_stream_impl` (line 394, error sites at 525/537, 591, 608, 620). Failure
  frames keep `errorText` and gain the stable code.
- `sdks/python/oss/tests/pytest/unit/agents/golden/run_request.attachment.json` — a **new** golden.
  Do not edit `run_request.claude.json` or `run_request.pi_core.json`; they are regression pins for
  something else.
- `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py` — assert the new golden; add
  `modelCapabilities` to `KNOWN_REQUEST_KEYS` (lines 54-82).
- `services/runner/tests/unit/wire-contract.test.ts` — assert the same golden. It reads the Python
  golden directory in place through `tests/utils/golden.ts`, so there is one copy.
- `sdks/python/oss/tests/pytest/unit/agents/test_dtos_content_blocks.py` — round-trip the new block
  fields.

### Acceptance criteria

- `cd sdks/python && py-run-tests` passes, including the new golden.
- `cd services/runner && pnpm test && pnpm run typecheck` passes against the shared goldens.
- `run_request.claude.json` and `run_request.pi_core.json` are byte-identical to before.
- A `file` part with no `providerMetadata` produces exactly the blocks it produces today.
- A `file` part with `providerMetadata.agenta.attachmentId` produces an `attachment` block, and a
  non-UUID value is ignored rather than forwarded.
- A resolved connection with no known modalities omits `modelCapabilities` entirely, and the runner
  reads that as unknown.
- A failed run surfaces a stable code, not only a sanitized string.
- `ruff format` and `ruff check` pass from `sdks/python`.

---

## Work package 4: frontend transport and rendering

The collection interface shipped dark in PRs #5458 and #5459 and the flag gating is complete
(`f2aa193cb2`). This package wires transport and rendering. It merges with the flag still off in
production.

### Modified files

- `web/oss/src/components/AgentChatSlice/assets/attachments.ts` (151 lines) — add a fourth kind for
  everything else so `validateIncoming` (117-151) stops rejecting an unrecognized type at line 131
  ("isn't a supported file type"), which contradicts D6. `kindForType` (62-70) currently returns null
  for anything unrecognized, and `kind` indexes `maxBytes` (line 134) and `KIND_NOUN` (32-36), so a new
  bucket is required rather than deleting the check. Add `perceived: boolean` per kind from the
  pre-send capability approximation; it drives the courtesy notice only.
- `web/oss/src/components/AgentChatSlice/assets/files.ts` (46 lines) — `filesToParts` (line 36) stops
  producing base64 `data:` URLs. `fileToPart` (21-33) is deleted. The module docstring (3-8) says
  "there is no upload server" and must be rewritten.
- New `web/oss/src/components/AgentChatSlice/assets/attachmentTransport.ts` — `uploadAttachment`,
  copying the shape of `uploadMountFile` (`web/oss/src/components/Drives/driveMedia.ts:167-192`):
  axios with `FormData` (line 182) and `onUploadProgress` (188). `web/AGENTS.md` requires the Fern
  client for new API code; the documented exception is binary and progress-reporting transport, and
  `driveMedia.ts` states both halves in its own comments (upload, 163-164: the Fern client uses fetch
  and cannot stream upload progress; download, line 56: Fern JSON-parses response bodies and mangles
  binary). Repeat the reason in the new file. Per the ruling, the **response is still validated with
  zod** through `safeParseWithLogging`, and the OpenAPI/Fern client is regenerated from an EE spec over
  HTTP so the rest of the domain has typed accessors.
- New `web/oss/src/components/AgentChatSlice/assets/attachmentMedia.ts` — the read side, copying
  `mountFileBlobQueryFamily` (`driveMedia.ts:72`) and `useMountFileObjectUrl` (146). The
  direct-URL-first with blob-fallback pattern in `useMountFileMediaSrc` (329) applies unchanged:
  same-origin cookie deployments stream natively, header-auth deployments fall back to an
  authenticated fetch and an object URL.
- `web/oss/src/components/AgentChatSlice/AgentConversation.tsx`:
  - line 1745, `useAttachmentUploads(files, setFiles, undefined)` gets the real uploader. The hook is
    at `hooks/useAttachmentUploads.ts:27` and its third argument is
    `(file: File, ctx: {onProgress: (percent: number) => void; signal: AbortSignal}) => Promise<void>`;
    when undefined, `enqueue` is a no-op. This one argument activates the whole progress, failure, and
    retry flow — `ComposerAttachments.tsx` already renders `StatusOverlay` (81-122) for `uploading`
    and `error`, and already takes `onRetry` (props at 142-158).
  - line 1878, `filesToParts(fileObjs)` becomes the reference-producing call, reading the uploaded ids
    off the tray entries and emitting `FileUIPart`s with the real content URL in `url` and
    `providerMetadata.agenta.attachmentId` alongside.
  - line 454, `const limits = DEFAULT_ATTACHMENT_LIMITS` becomes the capability-derived limits.
  - `attachmentsBlocked` (1815) already gates correctly; do not regress it.
- `web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx:447-481` — the `file` part render
  reads `file.url` directly in three places (`AudioPlayer src` 455, `FileCard src` 466, the download
  `<a href>` 472). Resolve through `attachmentMedia` instead of treating `url` as a `data:` URL.
- `web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts` — two branches change. The
  durable user `case "message"` (113-116) emits only a text part today, so a reloaded session loses
  every attachment on a user turn; extend it to emit `file` parts from `attributes.attachments`. The
  `case "file"` branch (234-241) emits no `filename`, so `filePartName` falls back to the URL tail;
  carry the filename through. Also render `attachment_delivery` records as the authoritative D6
  notice.
- `web/oss/src/components/AgentChatSlice/assets/constants.ts:39-40` — the comment still says
  "Paste/drag-to-attach on the composer predates this and is not gated", which `f2aa193cb2` made false.
  Fix it.
- `web/oss/src/components/AgentChatSlice/components/ComposerAttachments.tsx` — the workspace-only
  notice on a chip whose kind the model cannot perceive, and the authoritative notice once the run's
  `attachment_delivery` frames arrive.

### Turning the flag on

`isAgentFileUploadsEnabled` reads `NEXT_PUBLIC_AGENT_FILE_UPLOADS` and defaults to off
(`assets/constants.ts:42-43`; the variable is threaded through
`web/oss/src/lib/helpers/dynamicEnv.ts:39`). Turning it on is configuration, not code. WP4 sets it in
the local development environment files under `hosting/docker-compose/*/` so the stack exercises the
path, and leaves the production flip as its own deliberate act after WP1, WP2, and WP3 are all
confirmed deployed. Standing repo guidance: agent flags stay development-only and are never injected
at runtime.

### Tests

There is a gap to close first, and it is bigger than revision 1 said. `web/oss` has no
`vitest.config.ts` and no `test` script, and `web/oss/src` already contains **14** `*.test.ts` files
that no runner executes:

`AgentChatSlice/assets/transcriptToMessages.test.ts`, `pages/agent-home/assets/templates.test.ts`,
`pages/auth/assets/lastAuthMethod.test.ts`, `pages/settings/assets/navigation.test.ts`,
`SessionInspector/api.test.ts`, `Sidebar/components/assets/workflowEntitySelection.test.ts`,
`TemplateStrip/assets/codingAgentClipboard.test.ts`, `TemplateStrip/assets/pagerMath.test.ts`,
`lib/navigation/projectSwitchHref.test.ts`, `state/org/selectors/orgsDemoFilter.test.ts`,
`state/project/selectors/projectAtom.race.test.ts`,
`state/project/selectors/projectsDemoFilter.test.ts`, `state/url/template.test.ts`,
`state/workflow/hooks/workflowRouteGuard.test.ts`.

Per ruling R7: add `web/oss/vitest.config.ts` and a `test:unit` script with an **explicit include
list**, not a broad glob. Include the new attachment tests and
`AgentChatSlice/assets/transcriptToMessages.test.ts` (the one this package touches). Auditing and
migrating the other twelve is not Stage 1 scope; file an issue.

Then:

- `attachments.test.ts` — `validateIncoming` accepts an unrecognized type instead of rejecting it; the
  size cap still rejects; the count cap still rejects; a kind the model cannot perceive is accepted and
  flagged for the notice.
- `attachmentTransport.test.ts` — progress callbacks fire; an abort cancels; a failure surfaces a
  retryable error; the response is zod-validated and a drifted shape logs rather than throws.
- `transcriptToMessages.test.ts` — a user `message` record carrying attachment references produces
  `file` parts with filenames; an `attachment_delivery` record produces the notice.
- A Playwright check under `web/tests/playwright/` — attach an image, send, see it render in the sent
  message, reload the page, see it render again, and assert the outgoing request body contains no
  `data:` URL.

### Acceptance criteria

- Attaching a file uploads it once and the outgoing request body contains no `data:` URL.
- A saved and reloaded conversation renders the attachment from the content route, with its real
  filename.
- Attaching a ZIP succeeds and shows the workspace-only notice instead of "isn't a supported file
  type".
- The runner's `attachment_delivery` outcome overrides the composer's pre-send approximation in the
  rendered notice.
- With the flag off, the attach button, paste, and drag are all inert.
- `pnpm lint-fix` passes from `web/`.

---

## Design-doc sync

These edits land on the docs lane **during WP1**, because WP1 is the package that makes them true.
List only; this plan does not make them.

1. **`decisions.md`, the open question "How are unused uploads cleaned up (the refinement)?" (lines
   71-79).** The starting answer says a time-to-live sweep ships first. It still does, but the
   *marker* changed: nothing is referenced by being downloaded; a claim operation sets it. Rewrite the
   second and third bullets to name the claim.
2. **`design.md`, "Decision D7: enforcing that the original does not change" (lines 651-681).** Option
   B is described as "the create-only upload route plus never signing the mount". Widen it to the
   protected-mount policy: every generic mount operation behaves as though the mount does not exist,
   backed by a server-owned `purpose` column, and the create route is the only writer. The paragraph
   about `write_file` overwriting silently stays accurate and should stay.
3. **`design.md`, "Decision D3: where the original lives" (lines 141-186).** Add one sentence saying
   the mount is protected: invisible to mount listing, un-signable, un-editable, un-archivable on its
   own, and removed only by session teardown.
4. **`design.md`, "The media-type, validation, and limits matrix" (lines 346-449).** Two additions.
   (a) A session-quota row: 100 attachments and 256 MB of stored originals per session, 20 concurrent
   pending uploads, enforced at the create route. (b) A bounded-read rule stating that the create route
   reads at most the maximum raw cap plus one byte before classifying, because the EE stack has no
   gateway body cap at all — the "gateway ceiling" subsection (393-406) currently implies nginx is the
   only ceiling that matters, and it is absent from every EE deployment.
5. **`design.md`, "The media-type, validation, and limits matrix" → the count cap sentence (line ~377)
   and the per-message column.** It says the count is "enforced at the run route". Say the runner
   enforces it over the current user turn, with the composer's cap as the courtesy layer, and that the
   number is runner configuration, not API configuration.
6. **`design.md`, "Decision D5: the layered capability model" (lines 451-491) and "Two integration gaps
   to close" (493-506).** Layer three now has a defined default: unknown modalities mean
   workspace-only with the notice, never assumed vision. The second integration gap ("the runner error
   is a plain string") is answered by the structured `attachment_delivery` chain, not by an optional
   terminal `errorCode`; describe the chain from runner event through `wire.py` and the Vercel stream
   to the rendered notice.
7. **`design.md`, "The successful upload and delivery flow, end to end" (lines 243-297).** The
   sequence diagram shows the runner downloading and the API "checking the attachment belongs to this
   session". Add the claim step between "run turn" and "download", and change the upload step to the
   two-phase `pending` → `ready` create with an idempotency key.
8. **`design.md`, "Why the first upload can safely create the mount" (lines 819-844).** The closing
   paragraph says an unused upload "is handled by the garbage-collection follow-up in plan.md". Point
   it at the sweep and reaper that ship in Stage 1.
9. **`plan.md`, Stage 1 (a), the idempotency bullet (around line 120).** It says a retried upload after
   an ambiguous failure "creates a new resource rather than a duplicate", which contradicts the same
   bullet's own opening sentence. Replace with the idempotency-key contract.
10. **`plan.md`, Stage 1 (b), the ACP-blocks bullet (around line 155).** It points at `run-turn.ts`
    "currently near line 742". The call is at line 803. Also add the `currentUserTurn` refactor as the
    first runner item, since `plan.md` currently only says "update `resolvePromptText` and
    `messageText` callers".
11. **`plan.md`, Stage 1, deployment order.** It reads API → runner → frontend with the SDK folded into
    the runner step. Restate as the four reader-first packages with the flag as a fifth act.

---

## What I could not verify

- **That `input_modalities` can be populated at every `ResolvedConnection` construction site without a
  catalog miss on the common path.** I confirmed the six construction sites and that
  `claude_models.curated.json` carries `"modalities": ["text", "image"]`, but I did not check whether
  the resolver has the model id in the catalog's key space at each site (Pi's generated file keys on
  a different id space than the Claude aliases). If a common path misses, the default is
  workspace-only, which is safe but visible, so measure it before enabling the flag.
- **That `linkSync` behaves as create-exclusive on the local sandbox's durable cwd.** The cwd is a
  geesefs mount over the object-store prefix when geesefs can mount. POSIX `link` on a FUSE
  object-store filesystem may not be supported at all. If it is not, fall back to
  `writeFileSync(final, buf, { flag: "wx" })`, which is create-exclusive but not atomic, and accept a
  partial file on a crash. I did not test either against geesefs.
- **Whether `Permission.RUN_SESSIONS` is the right permission for the claim route.** The adjudication
  named permissions only for create and content. I chose `RUN_SESSIONS` because every other
  runner-side write in the same router uses it (`ingest_record_event` at line 529, `append_turn` at
  1134, the heartbeat at 270). I did not read `api/oss/src/core/access/permissions/types.py` beyond
  confirming the four constants exist at lines 169-174.
- **The exact HTTP status for `AttachmentQuotaExceeded`.** No ruling named one. I chose 429 with a
  detail naming the quota, because the pending-upload quota is backpressure and one code is simpler
  than splitting bytes from count. 507 would be more literal for the byte quota.
- **Whether `get_or_create_session_mount` is reachable from any route with a caller-supplied name.** I
  found only `get_or_create_session_cwd` (line 536) calling it with a fixed name, so the reservation
  may be defence in depth rather than a live hole. I did not enumerate every caller across `api/ee/`.
- **Whether the EE edition needs a parallel change.** The fact-check found EE does not wrap the
  sessions or mounts routers at all, so I assumed no. I did not read `api/ee/src/` myself.
- **The behaviour of the `with-nginx` compose profile end to end after the body-size raise.** The
  config line is verified; the deployed effect is not. The dev compose stacks and every EE compose file
  run no nginx, so the raise changes nothing for them — which is exactly why the bounded read in the
  API matters more than the ceiling.
- **Whether the Daytona `sandbox-agent` handle exposes any exclusive-create primitive.** I confirmed
  `mkdirFs`, `writeFsFile`, and `statFs` are the calls `prepareWorkspace` uses
  (`workspace.ts:64-95`), but I did not read the `sandbox-agent` package's full filesystem surface, so
  the accepted check-then-write race there may be avoidable.
- **How `attachment_delivery` should render in `ComposerAttachments` versus `AgentMessage`.** The
  composer owns the pre-send chip and the message owns the sent turn; I did not settle which surface
  shows the authoritative notice after the run, or whether both do. WP4's implementer decides.
