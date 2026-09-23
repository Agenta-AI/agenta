# Agenta primitives inventory for the channels feature

Date: 2026-07-20. Status: research input for the channels design (review copy on Mahmoud's fork). This file
answers one question: which primitives already in the Agenta codebase can the channels
feature (Slack first, Telegram second) reuse, which need generalizing, and which are
missing. File paths are cited so a reader can verify every claim against the code.

A note on freshness: the platform's own design docs are behind the code here. The page
`docs/design/agent-workflows/documentation/sessions.md` still says "the runtime has session
ids but no durable server-owned history." That was true when it was written; it is not true
anymore. A full server-side sessions subsystem (streams, turns, records, interactions,
mounts) now lives in `api/oss/src/core/sessions/` and is wired end to end through the
runner. Much of it landed recently (PR #4916 and follow-ups) and parts are still moving on
the current workspace, so treat exact shapes as current-as-of-today. Where the docs and the
code disagree, this file describes the code.

Vocabulary used throughout:

- **Session**: a conversation, identified by an opaque string `session_id` (regex
  `^[a-zA-Z0-9_-]{1,128}$`). The universal handle across every facet below.
- **Turn**: one request/response cycle inside a session — the user sends a message, the
  agent runs until it stops.
- **Harness**: the agent program that actually runs (Pi or Claude Code), driven by the
  runner sidecar over ACP.
- **Runner**: the Node sidecar (`services/runner/`) that executes one turn in a sandbox.
- **Agent service**: the Python SDK-based workflow app (`services/oss/src/agent/app.py`)
  that exposes `/invoke` and adapts the wire to the runner.
- **Interaction**: a stored request from a running agent to a human — an approval gate, an
  input request, or a client-tool call.

---

## 1. Sessions

### What exists today

Sessions are now first-class server objects, split into five facets, all keyed by
`session_id` and all scoped to a project:

- **Streams** (`api/oss/src/core/sessions/streams/`): the coordination plane. A durable
  `session_streams` row per session (name, description, tags, liveness flags, current
  `turn_id`) mirrored from a Redis lock nest with three nested booleans: `is_alive` ⊇
  `is_running` ⊇ `is_attached`. The service exposes a command matrix over
  `POST /sessions/streams/` (`SessionStreamCommandRequest` in
  `api/oss/src/core/sessions/streams/dtos.py`): **send** (start a turn; 409
  `SessionTurnInUse` if the session is already alive), **steer** (cancel the current holder
  and start a new turn), **cancel**, and **attach** (become a watcher of a live turn,
  receiving a `watcher_id`). The command endpoint runs nothing itself — it only manages
  locks and rows; the runner is the execution plane. Runners heartbeat
  (`POST /sessions/streams/heartbeat`) with a `replica_id` (container affinity — a session's
  warm sandbox belongs to one runner replica) and a `turn_id`; the heartbeat result tells a
  runner when its turn was cancelled out from under it. `kill` tears down the sandbox via a
  direct API→runner hop (`streams/runner_client.py`). Per-project concurrency is capped
  (`AGENTA_RUNNER_CONCURRENCY_LIMIT`); all TTLs are env-tunable
  (`api/oss/src/dbs/redis/sessions/contract.py`, `api/oss/src/utils/env.py`).
- **Turns** (`api/oss/src/core/sessions/turns/`): an append-only `session_turns` log. Each
  row records `session_id`, `stream_id`, `turn_index`, `harness_kind`, the harness-native
  `agent_session_id`, `sandbox_id`, workflow `references`, `trace_id`/`span_id`, and
  start/end times. Rows carry `created_by_id` from the invoking credential (the shared
  `LifecycleDBA` mixin, `api/oss/src/dbs/postgres/shared/dbas.py`). The runner appends a
  turn after each run (`services/runner/src/engines/sandbox_agent/session-continuity-durable.ts`)
  and reads the latest row at setup to resume the harness's own session.
- **Records** (`api/oss/src/core/sessions/records/`): the durable transcript. The runner
  posts every agent event to `POST /sessions/records/ingest`, authenticated **as the invoke
  caller's credential** (`services/runner/src/sessions/persist.ts`). Each record has a
  `record_type` (the neutral `AgentEvent` type: `message`, `thought`, `tool_call`,
  `tool_result`, `interaction_request`, ...), a `record_source` string (`"agent"` for
  engine events, `"user"` for the inbound user turn persisted at run start), an
  `attributes` JSON body (capped at 64 KB), and optional `turn_id`/`span_id`. Ingest
  publishes to a Redis stream (`streams:records`) consumed by a worker
  (`api/oss/src/tasks/asyncio/sessions/records_worker.py`) that writes the tracing DB.
  `POST /sessions/records/query` returns the log; the frontend replays it into a renderable
  conversation (`web/oss/src/components/AgentChatSlice/assets/loadSession.ts` →
  `transcriptToMessages.ts`), so any client — not just the browser that ran the turns — can
  reconstruct the conversation.
- **Interactions** (`api/oss/src/core/sessions/interactions/`): stored approval/input
  gates. Covered in section 4.
- **Mounts** (`/sessions/mounts/*` in `api/oss/src/apis/fastapi/sessions/router.py`):
  session-scoped durable file storage, including per-harness transcript-directory mounts
  (`claude-projects`, `pi-sessions`) that let a harness's native session files survive
  sandbox teardown.

On top of the facets, a root service (`api/oss/src/core/sessions/service.py`) provides
`POST /sessions/query` (filterable by workflow references — "all sessions of this agent"),
archive/unarchive, and a delete fan-out.

Session continuity across turns has two layers. Cold: the caller resends conversation
history on each turn and the model replays it. Warm: the runner parks a live harness
session in a per-replica pool between turns (`session-pool.ts`), records the harness-native
`agent_session_id` in the turns log, and on the next turn resumes the harness session
(same replica, or by reloading the harness transcript from the mounted transcript dir)
instead of replaying text. Warm resume is best-effort; cold replay is the guaranteed
fallback, which is why the wire still carries full history.

RBAC: every session endpoint checks a dedicated permission — `RUN_SESSIONS`,
`VIEW_SESSIONS`, `EDIT_SESSIONS` (`api/oss/src/core/access/permissions/types.py`).

Owner layer: the API owns the facets and the coordination plane; the runner owns
execution, record ingest, and turn appends; the SDK/agent service owns the invoke wire.

### What channels can reuse, what needs generalizing, what is missing

Reusable as-is: the session as the shared conversation object. A Slack thread maps to one
`session_id` (the id regex accepts a deterministic encoding of team+channel+thread). The
stream row gives the thread a name and liveness; `SessionTurnInUse` (409 on send) is
exactly the "the agent is already answering someone in this thread" signal a channel
gateway needs; steer/cancel map to "interrupt it". The records log plus the existing
records→messages replay is the cross-surface transcript: a thread driven from Slack opens
in the web app with full history, because the web app already hydrates any session from
records. Session lifetime as a config setting maps onto what exists: conversation lifetime
is unbounded (rows and records are durable, archive is explicit), while the warm-sandbox
TTLs are already env-tunable; a channels "session lifetime" setting is gateway policy
(when to mint a new session for a thread), not a new storage feature.

Needs generalizing: (a) session metadata — the stream row has free-form `tags` and `meta`
JSON, so channel origin (surface, team id, channel id, thread ts) can ride there today,
but if the gateway needs to find "the session for thread X" efficiently it needs either a
query over `meta` or its own mapping table; the honest generalization is a small
channel-binding table in the gateway rather than overloading stream tags. (b) Speaker
attribution — see section 8; `record_source` is the seam and is already a free string.

Missing: nothing structural. The session model was built for multi-client access
(project-scoped, credential-agnostic, coordination locks) and a channel gateway is just
another client of it.

---

## 2. Streaming protocol and the invoke path

### What exists today

One public contract runs a turn: `POST {serviceUrl}/invoke` with the generic workflow
envelope (`WorkflowServiceRequest` / `WorkflowInvokeRequest`,
`sdks/python/agenta/sdk/models/workflows.py`):

```jsonc
{
  "session_id": "sess_...",                  // optional; minted when absent
  "references": { "workflow": {...}, "workflow_variant": {...}, "workflow_revision": {...} },
  "data": {
    "inputs":     { "messages": [ /* history + current turn */ ] },
    "parameters": { "agent": { /* config override; omitted → revision's config */ } }
  }
}
```

The route negotiates transport from the `Accept` header: `text/event-stream` returns a
Vercel UI Message Stream framed as SSE; anything else returns one JSON
`WorkflowBatchResponse`. The header `x-ag-messages-format: vercel` selects the Vercel
UIMessage shape for `data.inputs.messages`; without it the neutral `{role, content}`
message shape is used. A dedicated `/messages` route existed earlier and has been folded
into `/invoke` (`sdks/python/agenta/sdk/agents/adapters/vercel/routing.py`). The playground
builds exactly this request (`web/packages/agenta-playground/src/state/execution/agentRequest.ts`)
with `project_id` as a query parameter and a normal project credential in `Authorization`
— the invoke path is authenticated like any API call, not a public endpoint.

Internally the runtime is protocol-neutral: the runner emits `AgentEvent` objects
(`services/runner/src/protocol.ts`, mirrored in
`sdks/python/agenta/sdk/agents/utils/wire.py`, pinned by golden fixtures), streamed as
NDJSON to the Python side, which either folds them into one batch answer or projects them
into Vercel stream parts (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`). The
event vocabulary includes text, reasoning, tool calls/results, interaction
requests/responses, files, data parts, usage, errors, and done.

Owner layer: the SDK owns the envelope and the adapters; the agent service composes them;
the web packages own the browser client.

### What channels can reuse, what needs generalizing, what is missing

Reusable as-is: the batch mode of `/invoke` is the natural channel-gateway call. A
messaging surface does not want token-level SSE — Slack replies are posted or edited as
whole messages. The gateway POSTs `/invoke` with `Accept: application/json`, gets one
assistant message, posts it to the thread. The trigger dispatcher already invokes
workflows server-side by building this same `WorkflowServiceRequest`
(`api/oss/src/tasks/asyncio/triggers/dispatcher.py`), so "a platform component invokes an
agent on behalf of an external event" is established practice, not a new pattern.

Needs generalizing: progressive updates. If the channel UX wants "is typing" or streamed
message edits, the gateway can consume the SSE mode, but a coarser server-side signal
(e.g. the records Redis stream, or the stream row's `is_running` flag) may be the better
seam than parsing Vercel UI parts outside a browser. The neutral `AgentEvent` layer is the
right level for a non-browser consumer; a thin "adapter for machine consumers" (NDJSON or
neutral-event SSE instead of Vercel parts) would be a small addition inside the existing
adapter architecture rather than a parallel protocol.

Missing: nothing for the MVP. The fold-to-one-message batch path exists and is tested.

---

## 3. Cross-surface session continuity — what is free, what is not

This section answers the direct question: Mahmoud expects cross-surface continuity to come
for free from the session model. What exactly IS free today?

**Can an external service post a user message into an existing session and trigger a turn
via API today?** Yes, with one important qualifier. The mechanical path exists end to end:
POST `{serviceUrl}/invoke` with the existing `session_id`, workflow `references`, and the
message under `data.inputs.messages`, authenticated with a project credential. The runner
will resume the session (warm, via the parked sandbox or the durable turns log and
transcript mounts, on the replica that owns the session) or fall back to cold replay, and
the records/turns/stream facets all update. The qualifier: **the wire contract still
expects the caller to send conversation history, not just the new message.** The server
stores the transcript (records) but the invoke path does not yet load it into the model
context server-side; history-in-context is the caller's job on every turn (warm harness
resume often makes the replay redundant in practice, but it is best-effort, and the
contract does not let the caller rely on it). So a channel gateway must either (a)
maintain its own per-thread history, or (b) rebuild history from
`POST /sessions/records/query` the way the web app does — the replay logic exists
(`transcriptToMessages.ts`) but only as frontend TypeScript; a server-side consumer would
reimplement it or we port it to a shared place. The clean fix — a server-side
"create-or-resume: if `session_id` is known, hydrate history from records before the
turn" — is exactly the intended-but-unbuilt behavior already described in
`documentation/sessions.md`. That is the single generalization that makes continuity
actually free for every surface at once.

**Is there concurrency safety when two surfaces write?** Yes. The stream command plane
(`send` → 409 `SessionTurnInUse` when alive; `steer` to interrupt) plus the runner-side
alive/running locks serialize turns per session. A channel gateway gets queueing/conflict
semantics for free; it should use the same send-then-invoke discipline the platform's own
components use rather than blind-firing `/invoke`.

**Is there speaker attribution on messages?** Partially, and this is the biggest genuine
gap. Three layers: (1) The **turn** row records `created_by_id` — the Agenta user behind
the credential that ran the turn. If each Slack user is linked to an Agenta identity and
the gateway invokes with a per-user credential, per-turn attribution is free. (2) The
**record** for the inbound user message carries only `record_source: "user"` — a free
string with no user id field. Nothing stops the gateway writing `"user:<agenta_user_id>"`
or adding attribution inside `attributes`, but no schema, no UI rendering, and no replay
logic understands that today. (3) The **model** sees whatever the caller puts in message
content; there is no wire field for "who is speaking" on a message. For group threads the
gateway must prefix speaker names into the message text (which is also what every vendor
surveyed in the light pass does) until a first-class `sender` field is added to the
message/record shape.

**Can two humans write into one session?** Yes, today. Sessions are project-scoped, not
user-owned: any project member whose credential passes `RUN_SESSIONS` can invoke a turn on
any `session_id` in the project, and the locks serialize them. There is no per-session ACL
and no notion of a session owner beyond `created_by_id` on rows — which is exactly right
for the "one shared session per thread" decision. The flip side: there is also no
mechanism to *restrict* a session to its participants, which the future group-safety rule
("group-visible replies must not use member-private resources") will eventually want as a
policy input.

**What auth would the channel gateway need?** Today's only credential that acts as a
specific user is the project-scoped API key: `verify_apikey_token`
(`api/oss/src/middlewares/auth.py`) resolves the request to
`user_id = api_key.created_by_id` plus the key's project. So "the agent acts with the
invoking user's permissions" is implementable now by holding one API key per linked user
per project — workable for an MVP, ugly at scale (key sprawl, keys minted by users, no
scoping-down). What does not exist: any token-exchange, impersonation, or service-account
primitive ("act as user X" given a gateway credential), and no non-user machine principal
at all. The natural seams for building it: the `user_identities` table
(`api/oss/src/dbs/postgres/users/dbes.py`, unique `(method, subject)` → `user_id`) is
purpose-built for external-identity linking — a `channel:slack:<team_id>` method with the
Slack user id as `subject` slots in without schema changes; and the middleware already
mints short-lived internal `Secret` JWTs carrying a resolved
`(user_id, project_id, workspace_id, org_id)` scope — a gateway-facing "mint a scoped
token for linked user X" endpoint would formalize that existing mechanism instead of
inventing a new one.

Summary: free today — durable shared transcript, session-by-reference lookup, turn
serialization, resume of warm harness state, per-turn user attribution, replay of a
session into any UI. Not free — server-side history hydration on invoke (the caller still
ships history), per-message speaker identity, per-user credentials without key sprawl,
and a push signal to other surfaces that a session got new content (see section 7).

---

## 4. Approvals

### What exists today

Approvals are addressable, stored objects — not just stream frames. The chain:

1. A tool carries `permission: "allow" | "ask" | "deny"` (per tool) resolved against the
   runner-level default `allow | ask | deny | allow_reads`
   (`sdks/python/agenta/sdk/agents/tools/models.py`). "Ask" gates the call.
2. When a gate fires, the runner emits an `interaction_request` event into the live stream
   AND fire-and-forgets `POST /sessions/interactions/`
   (`services/runner/src/sessions/interactions.ts`), creating a durable
   `SessionInteraction` row: own UUID, `session_id`, `turn_id`, correlation `token`,
   `kind` (`user_approval` | `user_input` | `client_tool`), `data.request` (tool + args),
   and — critically — `data.references`/`data.selector`: the workflow-revision pointers
   captured at gate time so a later respond re-runs the same revision. Status lifecycle:
   `pending → responded | resolved | cancelled` (verdict lives in the resolution content,
   not the status). An unanswered approval **ends the turn** and parks the session
   (`pause.ts`; the approval-parked session has a longer pool TTL), so an approval that
   arrives hours later from Slack is a normal resume, not a held-open connection.
3. The decision can come back on two planes. **Interactions plane**:
   `POST /sessions/interactions/{interaction_id}/respond` with an `answer` — the endpoint
   CAS-flips the row to `responded` (concurrent responders fire exactly once) and then
   invokes the workflow from the stored references with `data.inputs = answer`, either
   inline or via the dedicated TaskIQ interactions worker
   (`api/oss/src/tasks/taskiq/sessions/interactions_worker.py`). **Messages plane**: the
   decision rides the next `/invoke` turn's history as a `tool-approval-response` part;
   the runner then marks the row `resolved`. Query surface:
   `POST /sessions/interactions/query` with `actionable_only`, plus
   `GET /sessions/interactions/{id}`.
4. The frontend renders the gate from the stream part (`tool-approval-request`) and on
   reload re-hydrates pending gates from the interactions query (`ApprovalDock.tsx`).

One more detail that looks deliberately placed for channels: `SessionInteractionFlags` has
`delivered_in_band` and **`delivered_webhook`** booleans
(`api/oss/src/core/sessions/interactions/dtos.py`). The runner sets `delivered_in_band`;
nothing sets `delivered_webhook` yet — the flag is a reserved slot for out-of-band
delivery.

### What channels can reuse, what needs generalizing, what is missing

Reusable as-is: essentially everything. This is the strongest primitive in the inventory
for the channels use case. An approval in Slack is: notice a pending interaction, render
it as a message with Approve/Deny buttons, and on click call
`/sessions/interactions/{id}/respond` — the resume happens server-side with no browser
involved, against the pinned revision. The parked-turn semantics mean latency is free.

Needs generalizing: delivery. Today the gateway would have to poll
`interactions/query?actionable_only`. The generalization is already half-declared: emit a
platform event when an interaction is created and let the outbound webhook subsystem
(section 6) deliver it, setting `delivered_webhook`. Concretely: add
`SESSIONS_INTERACTIONS_CREATED` (and probably `..._TRANSITIONED`) to `EventType` and
`WebhookEventType` (`api/oss/src/core/webhooks/types.py`) — the subscription, signing,
retry, and delivery-log machinery all exists.

Missing: attribution of the decision. `respond` stamps the responder's `user_id` from the
request credential, which works if per-user credentials exist (section 3); there is no
policy layer for *who may approve* beyond `RUN_SESSIONS` (any project member with run
rights can approve anyone's gate — fine for now, a policy hook later).

---

## 5. Identity and RBAC

### What exists today

Hierarchy: Organization → Workspace → Project, with a membership table and a free-form
`role` string at each level (`api/oss/src/models/db_models.py`). RBAC is OSS, always-on:
~90 permission slugs and six default roles with cumulative permission sets
(`api/oss/src/core/access/permissions/types.py`); endpoints call
`check_action_access(user_uid, project_id, permission)` directly. EE's only twist is a
plan-entitlement bypass and custom role catalogs.

Authentication (`api/oss/src/middlewares/auth.py`) accepts four schemes: SuperTokens
browser sessions (Bearer/cookie), project-scoped **API keys** (`ApiKey`, format
`prefix.secret`, sha256-stored, `api/oss/src/services/api_key_service.py`), short-lived
internal **Secret** JWTs (15 min, HS256 over `env.agenta.auth_key`, a propagation token
minted after a successful auth), and the platform-admin **Access** token. Every request
resolves to a frozen scope `(organization_id, workspace_id, project_id, user_id)`
(`api/oss/src/utils/context.py`).

External identity linking exists and is generic: the `user_identities` table maps
`(method, subject)` → `user_id`, where `method` encodes the mechanism
(`email:otp`, `social:google`, `sso:{org}:{provider}`), with a wildcard-aware taxonomy in
`api/oss/src/core/auth/types.py`. EE adds per-org SSO providers and verified domains with
auto-join. There is no SCIM, no service account, no impersonation/token exchange. An API
key is the de-facto delegation primitive: it acts as its creating user within one project.

Test/ops account minting: `POST /admin/simple/accounts/` (Access-token-gated) scaffolds a
full user+org+workspace+project graph with API keys
(`api/oss/src/core/accounts/service.py`).

### What channels can reuse, what needs generalizing, what is missing

Reusable as-is: the `user_identities` table is the account-linking primitive the channels
decision requires ("per-user account linking between channel identity and Agenta
identity"). Adding a method family like `channel:slack:{team_id}` with the platform user
id as `subject` requires no schema change — only extending the `MethodKind` taxonomy and
writing the linking flow (a DM from the bot with a magic link is the standard UX from the
vendor survey). RBAC needs nothing new: channel-initiated turns are ordinary
`RUN_SESSIONS` invocations under the linked user.

Needs generalizing: credential minting for the gateway. The architecture decision says the
agent acts with the invoking user's permissions now but must stay open for agent-own
identity later. The generalization that serves both: a first-class delegated-token
primitive — the gateway authenticates as itself (one credential) and exchanges
`(linked identity, project)` for a short-lived scoped token. The internal Secret JWT is
this exact object without a public minting path; formalizing it is a contained change in
the auth middleware layer. The later "agent-own identity" then becomes a non-user
principal that the same minting path can issue for — which is also the first real service-
account requirement in the codebase.

Missing: the service-account/machine principal itself (every credential today ends at a
human `user_id`), and any admin surface for identity linking.

---

## 6. Credentials and connections

### What exists today

Two subsystems, both project-scoped, neither per-user:

- **Vault secrets** (`api/oss/src/core/secrets/`, `api/oss/src/apis/fastapi/vault/router.py`):
  PGP-encrypted at rest, kinds `provider_key`, `custom_provider`, `custom_secret`,
  `sso_provider`, and `webhook_provider` (webhook signing keys live in the vault). The DB
  supports project XOR organization scope; the HTTP API only exposes project scope. No
  `user_id` column. The SDK resolves exactly one model connection per run
  (`sdks/python/agenta/sdk/agents/platform/connections.py`) and injects provider env vars
  onto the `/run` wire (`secrets` field) — never onto the agent filesystem.
- **Gateway connections** (`api/oss/src/core/gateway/connections/`, table
  `gateway_connections`): the general "this project is connected to an external SaaS
  account" primitive, currently backed by Composio (`provider_key`, `integration_key`,
  `connected_account_id`, `auth_config_id`, OAuth or API-key auth scheme, `is_valid`
  flag). The OAuth flow is server-owned with an HMAC-signed state token carrying
  `project_id` + the initiating `user_id` (`gateway/connections/utils.py`) — but the
  Composio-side account is keyed by `str(project_id)`, so **one project shares one
  connected account per integration**; the human user in the state is audit-only. Both
  tools and triggers consume the same rows. `ConnectionProviderKind` already enumerates
  `composio | agenta`, i.e. the model anticipates non-Composio providers.

A vestigial `agent_secret_leases` module (per-user/per-run secret leases) was built and
removed; only stale bytecode remains. It is prior art if per-user credentialing returns.

### What channels can reuse, what needs generalizing, what is missing

Reusable as-is: the `gateway_connections` row is the right home for "this workspace's
Slack app installation": provider_key `slack` (a native adapter, not Composio),
integration/auth metadata in `data`, validity flag, project scope. The
"bring your own platform app" requirement for self-hosters maps to the existing
custom-provider pattern in the vault (bot token, signing secret as vault secrets
referenced from the connection). The server-owned OAuth callback with HMAC state is
exactly the Slack app-install flow shape.

Needs generalizing: (a) a first non-Composio connection provider adapter — the port
exists (`ConnectionsService` + provider adapters), so this is filling in an interface,
not inventing one. (b) Multiple apps per workspace is already fine: connections are rows,
several per project, unique on `(project, provider, integration, slug)`. (c) The
one-app-per-agent binding does not belong on the connection — it is the channel-binding
object (section 7).

Missing: per-user external credentials. Today a connection is project-communal. The
future group-safety rule ("group replies must not use member-private resources") only
becomes meaningful once member-private resources exist — i.e. when connections or secrets
gain a user scope. The enforcement seam is already right: the SDK platform resolution
layer (`sdks/python/agenta/sdk/agents/platform/resolve.py`) is the single chokepoint
where every credential and tool connection enters a run, so a future policy
("session is group-visible → resolve only project-scoped resources") is one filter in one
place. Nothing needs to be pre-built now except not scattering resolution.

---

## 7. Triggers and ingress

### What exists today

Two opposite-direction subsystems that the naming obscures:

- **Triggers = inbound** (`api/oss/src/core/triggers/`, ~1700-line service, full DB
  layer, tests): substantially implemented, not design-only. The Composio event receiver
  `POST /api/triggers/composio/events/` is a real public webhook endpoint: allowlisted
  past auth (`_PUBLIC_ENDPOINTS` in `api/oss/src/middlewares/auth.py`), HMAC-SHA256
  signature verification with timestamp replay protection and secret rotation
  (`core/triggers/service.py`, `verify_signature`), ack-fast with a 202, and dispatch via
  a TaskIQ queue onto a worker that builds a `WorkflowServiceRequest` and invokes the
  bound workflow (`api/oss/src/tasks/asyncio/triggers/dispatcher.py`). A
  **TriggerSubscription** binds `connection_id` + `event_key` + an input-mapping template
  + workflow `references` + `selector`; referencing by artifact/variant resolves to the
  latest revision at dispatch time, referencing by revision id pins a version (the
  "latest binding" semantics, `api/oss/src/core/workflows/service.py`). Cron-style
  TriggerSchedules mirror subscriptions.
- **Webhooks = outbound** (`api/oss/src/core/webhooks/`): customer-facing subscriptions
  to platform events (`WebhookEventType`, a subset of `EventType`), signed deliveries
  (`X-Agenta-Signature: t=...,v1=hmac`), SSRF-hardened IP-pinned sends, retries, and a
  delivery log — driven by its own TaskIQ worker.

Queueing infrastructure: TaskIQ over Redis Streams with per-domain queues (webhooks,
triggers, interactions, evaluations) consumed by a single worker entrypoint
(`api/entrypoints/worker_queues.py`), plus raw Redis Streams for event fan-out. The
"receive → verify signature → 202 → enqueue → worker invokes the workflow" shape a Slack
Events API receiver needs is the production shape Composio ingress already has.

The static workflow catalog (`api/oss/src/core/workflows/static_catalog.py`) is the
platform's pattern for code-owned, DB-free resources under the reserved `__ag__*` slug
namespace with deterministic UUIDv5 ids — relevant to channels if platform-owned helper
workflows or client-tools (like the existing `__ag__request_connection`) are needed for
the linking flow.

### What channels can reuse, what needs generalizing, what is missing

Reusable as-is: the entire ingress skeleton. A Slack receiver is the same five steps as
the Composio receiver with a different signature scheme (Slack signs
`v0:{timestamp}:{body}` — structurally identical to the Composio HMAC already
implemented) plus Slack's `url_verification` challenge. The TaskIQ queue pattern, the
public-endpoint allowlist mechanism, and the dispatcher-builds-invoke pattern transfer
directly.

Needs generalizing: the binding object. A **TriggerSubscription** is already "external
event source + connection + workflow reference + input mapping"; a **channel binding**
("this Slack app in this workspace drives this agent") is the same shape plus
conversation semantics (thread→session mapping policy, session lifetime, DM policy,
allowed channels). The decision to make is generalize-vs-sibling: either extend triggers
with a session-aware delivery mode (the triggers design doc explicitly left "session
behavior for triggered runs" open — `documentation/triggers.md`), or build a channels
domain that reuses the same `Reference` binding and connection rows. Given that triggers
are fire-one-run and channels are converse-in-a-session, a sibling domain reusing the
same primitives (connection, reference binding, latest-binding resolution, queue,
dispatcher) is the honest shape; what must NOT happen is a second connection store or a
second reference-resolution scheme.

Missing: outbound push of session/interaction events (the gateway needs to know "agent
finished a turn in session X" and "approval pending in session X" without polling).
`EventType`/`WebhookEventType` have no session or interaction events yet; the
`delivered_webhook` flag on interactions is waiting for exactly this. Adding session
event types to the existing outbound-webhook subsystem is the generalization; a
channel-gateway-internal Redis subscription to `streams:records` is the lower-latency
in-cluster alternative.

---

## 8. Extensibility points

### What exists today

- **Skills**: inline packages (`SkillTemplate`: name, description, body, bundled files)
  declared in the agent config, resolved server-side (including `@ag.embed` references
  that pull reserved `__ag__*` catalog skills), shipped whole over the `/run` wire, and
  materialized into skill dirs per harness
  (`sdks/python/agenta/sdk/agents/skills/`, `services/runner/src/engines/skills.ts`).
  Platform-forced skills (`AGENTA_FORCED_SKILLS`) are unioned into every `pi_agenta` run.
- **Tools**: one discriminated union `ToolConfig` with six types — `builtin`, `gateway`
  (Composio), `code`, `client` (browser-fulfilled), `reference` (workflow-as-tool),
  `platform` (an Agenta endpoint by `op` name) — on three axes: type, permission
  (approval), render hint (`sdks/python/agenta/sdk/agents/tools/models.py`). Resolution
  is a single SDK chokepoint (`ToolResolver` + injected adapters,
  `sdks/python/agenta/sdk/agents/platform/resolve.py`); platform ops live in a code-owned
  catalog (`platform/op_catalog.py`, namespace `tools.agenta.*`) with `$ctx.*` context
  bindings; gateway/reference/platform calls all execute through `POST /tools/call` so
  the runner never becomes an arbitrary HTTP client.
- **Agent config**: the `agent-template` catalog type (`sdks/python/agenta/sdk/utils/types.py`)
  — instructions, llm (model/provider/connection), tools, mcps, skills, plus harness /
  runner / sandbox sections each with typed keys and an untyped `extras` escape hatch.
  Config lives on workflow revisions with git-style history; invocation references
  resolve latest-vs-pinned.

### What channels can reuse, what needs generalizing, what is missing

Reusable as-is: the hard rule from the working agreements — agent-behavior fixes happen
at the SDK layer via op schemas and skills, not the core API — has ready-made vehicles
here. A "channels etiquette" platform skill (how to behave in a group thread, how to
address speakers) is a forced-skill entry. If the agent should be able to act on the
channel (post to another channel, look up a user), that is a `gateway` or `platform` tool,
not new runtime code. The `client_tool` interaction kind generalizes to "surface-fulfilled
tool" — a tool the *channel gateway* fulfills (e.g. "ask the thread a question with
buttons") rides the same stored-interaction machinery as approvals.

Needs generalizing: the agent config is the natural home for channel-relevant policy
(session lifetime, group-reply policy) under a new typed section — the `extras` pattern
means an MVP can ship config without schema churn and graduate keys later.

Missing: nothing significant; this layer is the most deliberately extensible part of the
stack.

---

## 9. Gap list, ranked by build effort

Smallest first. "Gap" means: required by the channels feature as decided, and not
reusable from an existing primitive without work.

1. **Session/interaction event types on the outbound event bus** — add
   `SESSIONS_INTERACTIONS_CREATED` (and turn-completed) to `EventType`/`WebhookEventType`
   and emit at creation; the whole delivery machine exists. Unblocks push-based approval
   delivery to any surface. (Days.)
2. **`channel:*` identity methods + linking flow** — extend the `MethodKind` taxonomy,
   write the link-account UX (bot DM with magic link), store rows in `user_identities`.
   No schema change. (Days, plus UX.)
3. **Slack signature verification + events receiver** — clone the Composio receiver
   pattern (public path allowlist, HMAC verify, 202, TaskIQ enqueue). (Days.)
4. **Channel-binding object** — a new domain table: platform app (a `gateway_connections`
   row via a native Slack provider adapter) + agent `Reference` (latest-binding) +
   conversation policy (thread→session mapping, session lifetime, DM policy). Sibling of
   TriggerSubscription, reusing its parts. (A week-ish with CRUD + UI.)
5. **Native (non-Composio) connection provider adapter for Slack app installs** — fill in
   the existing `ConnectionsService` provider port; OAuth install flow reuses the signed-
   state callback pattern. Self-hosters paste their own app credentials into the vault.
   (About a week including token rotation handling.)
6. **Server-side records→messages replay ("resume from server history")** — the single
   biggest continuity generalization: on `/invoke` with a known `session_id` and absent
   history, hydrate model context from the records log server-side (port
   `transcriptToMessages` semantics into the SDK/service layer). Makes continuity free
   for every surface and thins every future client. (1–2 weeks; touches the invoke
   contract, needs a policy for partial/failed turns.)
7. **Speaker attribution on messages/records** — a `sender` field (display name + linked
   user id) on the inbound message shape and the record schema, rendered in the web
   transcript and prefixed into model context. Until then the gateway prefixes names in
   text. (1–2 weeks across wire, records, replay, UI.)
8. **Delegated per-user tokens for the gateway** — formalize the internal Secret JWT into
   a mintable, short-lived, scoped credential ("gateway acting for linked user X in
   project Y"), replacing per-user API-key sprawl; designed so a non-user (agent-own /
   service-account) principal fits later. (2+ weeks; auth middleware + policy + admin
   surface. The MVP can ship on per-user API keys first.)
9. **Group-safety policy hook** — only becomes real once per-user resources exist;
   pre-work is merely keeping all credential/tool resolution behind the single SDK
   resolution chokepoint, which is already the case. (Cost now: zero. Later: a resolver
   filter keyed on a session visibility flag.)
