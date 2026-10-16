# Sharing data and responsibilities

## Context

Code evidence was rechecked against release/v0.122.8 at `0f6137987e3c19d4b8640d28c81ba0612c707ea5`. Paths below are relative to the repository root. These are source observations, not results from an implemented privacy system.

| Area | Today and evidence | Expected |
| --- | --- | --- |
| Workflow identity | `api/oss/src/core/workflows/dtos.py:144` puts `is_agent` on revisions. Stable artifacts also serve prompts and evaluators. | Keep agent access on a stable artifact extension. Do not infer access from the requested revision's flag. |
| Session state | `api/oss/src/dbs/postgres/sessions/streams/dbes.py:69` explains that heartbeats replace flags. | Store access in dedicated columns and invitation rows. |
| Project roles | `api/oss/src/core/access/permissions/service.py:308` has the EE entitlement bypass; `:329` has owner shortcuts. | Preserve capability resolution, but apply mandatory agent/session access afterward. |
| Traces and metrics | `api/oss/src/apis/fastapi/tracing/router.py:508` and `:571` check VIEW_SPANS for analytics. `web/packages/agenta-observability/src/api/dashboard.ts:20` uses analytics. | Keep both checks and defaults. Restricted trace policies also restrict these metrics. |
| Cost display | `web/packages/agenta-chat/src/components/TurnMetrics.tsx:8` combines trace and message usage; `web/packages/agenta-chat/src/assets/trace.ts:102` contains trace-derived calculations. | Missing access means unavailable values, not zero cost. No complete fallback is promised. |
| Slack history | `api/oss/src/dbs/postgres/channels/dbes.py:135` defines append-only threads; `api/oss/src/dbs/postgres/channels/dao.py:483` deletes channel agents. | Store the workflow artifact parent on the thread so deletion does not break historical access. |
| Channel actor | `api/oss/src/tasks/asyncio/channels/inbox.py:1049` can invoke under a linked user or creator. | Keep external sender attribution and bound installation authority separate from technical user IDs. |
| Historical owner | `api/oss/src/middlewares/auth.py:1060` uses API-key creator identity; `api/oss/src/core/sessions/streams/service.py:765` includes creation without a human actor. | Never infer a human session owner from created_by_id alone. |

## Goals / Non-Goals

Goals: independent agent and web-session sharing; collaborative sessions; unchanged legacy access; a small data model; one access decision boundary; future EE custom-role compatibility.

Non-goals: personal credential delegation, per-session trace filtering, trace schema changes, a usage-only analytics API, a generic permission graph, custom-role administration UI, Slack user linking, a new Slack delivery feature, or a full RBAC rewrite.

## Decisions

### Data structures

| Structure | Fields and constraints | Writer |
| --- | --- | --- |
| agent_access | Composite key `(project_id, artifact_id)` referencing the workflow artifact; `visibility: private or project`; nullable `owner_user_id`. Private requires an active member owner. Null owner is allowed only for legacy project-visible records pending assignment. | Agent creation and dedicated sharing/transfer service. |
| session_streams | `visibility: private or project`; `owner_user_id`. Apply explicit sharing to classified web agent chats. Private requires an owner. Existing non-agent session semantics remain unchanged. | Session creation and sharing service. |
| session_grants | Composite unique key `(project_id, stream_id, user_id)`; `role: viewer or participant`; project-qualified foreign key to session. Owner is derived from the session row, not duplicated. | Session owner through sharing service. |
| channel_threads | Immutable `artifact_id`, qualified by project. New threads require a verified parent. Migration can temporarily leave unresolved historical rows null. | Channel service resolves the selected workflow before creating the thread. |

Every user grant is limited to the same project. Current membership is required even if a stale grant remains. Creation, transfer, and visibility updates validate membership inside the write transaction. Access fields are not editable through generic metadata, heartbeat, or model-generated configuration updates.

| Option | Trade-off | Choice |
| --- | --- | --- |
| Visibility and ownership in one enum | Conflates audience and management; transfer becomes unclear. | Reject. |
| Access columns on every workflow artifact | Fewer joins, but changes shared prompt/evaluator storage. | Reject for this scope. |
| **Agent access extension; separate owner and visibility** | One join and explicit creation/migration paths. Isolates legacy workflows. | **Choose.** |
| Named grants in session JSON | Fewer tables, but harder uniqueness, concurrent updates, and user-based list filtering. | Reject. |
| **Small invitation table** | One extra table; direct indexes and uniqueness. | **Choose because named Viewer/Participant sharing is agreed.** |

Absence of agent_access means historical project behavior only for legacy or non-agent artifacts. Agent creation UI, template loading, and agent-aware SDK creation write access in the artifact transaction. Once an access row exists, no ordinary update may delete it to restore legacy access. Direct variants, revisions, clones, mounts, and skills resolve that artifact before authorization.

### Session rules

Owner reads and manages sharing, deletion, and archiving. Participants read and contribute. Viewers read. Sending to an agent additionally requires permission to use that agent and the existing project execution capability. Reading web-session history does not require agent use. Project visibility grants Viewer access in this first scope; named Participants can contribute. Choosing Only me removes project visibility and every named invitation in one transaction.

New agent UI creations and new web agent chats request private access. Older clients that omit new policy fields retain the prior project default during rollout. This compatibility rule must be explicit in API validation and tests.

### Responsibility by layer

| Layer | Responsibility |
| --- | --- |
| Router | Authenticate, validate request shape, pass trusted context, map errors. |
| Core resource service | Load resource facts, require access, perform business operations. Background entry points use the same service. |
| Core access service | Resolve membership, capabilities, owner and invitations. Produce decisions or typed read scopes. No SQLAlchemy. |
| DAO | Translate typed read scopes into SQL before ordering, counts, pagination, and search. Constrain writes. |
| Runner/channel boundary | Carry server-derived authority through tool calls. Never derive authority from prompt text. |
| File/credential service | Resolve parent access and issue only required permissions. No independent file invitation list. |

The direct-read rule and list scope must pass the same scenario fixtures. Privacy checks are a mandatory AND after project capability checks. EE entitlement and organization-owner shortcuts cannot bypass agent or session access. Trace access remains the stated exception.

### Make private and transfer

An active owner with the existing edit capability can manage their agent sharing. A project member with the new manage-agent-sharing capability can manage project-visible agents and recover ownerless project-visible agents. Map that capability to existing project administrators initially. It does not allow reading someone else's private agent or session by itself.

A dedicated transaction validates the target owner, checks the current policy version or locks the row, and updates owner and visibility together. Show affected installations and schedules before confirmation. Making private pauses external channel invocation. Queue workers and sensitive tool operations recheck authority; work that loses authority stops before its next external action. Other people's web-session history stays under session access. Their next agent invocation is denied. Slack history follows the original artifact's current audience. Making project-visible again does not silently reactivate paused installations. Ownership transfer does not transfer connection secrets.

### Slack audience and execution

Verified Slack events pass the existing installation and allowed-space checks after existing routing selects the agent. A bounded internal context carries project, binding, artifact, session, and external sender. It grants execution of that installed agent, not the installer's general permissions. Subagent and tool access remain bounded by the configured authority. Actions that require an Agenta approver remain pending for an authorized Agenta user; an unlinked Slack identity cannot satisfy that role.

Agenta readers follow the associated agent audience, including Slack direct messages and private-channel conversations. Explain that audience in installation setup. Never copy Slack membership or add named Slack-session grants. Rebinding starts a new session association. Historic threads keep their artifact. Disconnect stops new requests and retains the history association. Deleted protected parents deny reads; unresolved legacy parents retain only documented pre-migration access until classified.

### Trace and analytics policy

| Option | Trade-off | Choice |
| --- | --- | --- |
| **Keep existing trace capabilities and assignments** | Preserves analytics and legacy usage. Trace readers can inspect private-chat content. | **Baseline for this change.** |
| Admin-only trace access in an explicitly restricted deployment | Smaller content audience; non-admin analytics and some cost displays disappear. EE bypasses must enforce the restriction first. | Supported policy direction, not an automatic migration or a new per-project settings feature. |
| Separate analytics and content capabilities | Supports aggregate costs without transcript access; requires a bounded metrics API review. | Deferred. |
| Per-session tracing | Stronger content privacy; substantial query and migration changes. | Out of scope. |

Current EE catalog overrides are deployment settings, not proof of a per-project policy switch. Do not promise a switch that does not exist. Keep trace ingestion, storage, queries, billing collection, and role defaults unchanged. The UI must state that project trace readers can inspect captured session content. If a restricted policy is selected, denied metrics display as unavailable. Do not treat denial as zero usage or zero billable cost.

Competitor evidence supports separating analytics from content as a later capability. Dust documents admin analytics without conversation access. Langdock gives creators/editors analytics and separately shared feedback chats. Gumloop describes analytics permissions separately from saved conversation access. These are vendor statements, not enforcement tests:
- https://docs.dust.tt/docs/user-documentation/getting-started/use-cases-and-guides/collaboration
- https://docs.langdock.com/en/using-langdock/agents/analytics
- https://docs.gumloop.com/core-concepts/agent_performance

### RBAC migration

Keep role IDs and current capability defaults. Put legacy membership reads behind a core interface implemented by a DAO. Route old and new consumers through one resolver. Future EE stored custom roles can implement the same catalog boundary. Services ask for capabilities, not role names. This release does not implement custom-role persistence or UI. Membership synchronization must not restore deliberate removals or overwrite deliberate roles.

## Risks / Trade-offs

- Private means restricted agent/session/file APIs, not confidentiality from trace readers. This exception is visible in the sharing UI and documentation.
- Historical creator data can be ambiguous. A verified human classification may apply to few old sessions.
- Files already downloaded cannot be recalled. Issued storage credentials remain valid until expiry. Document actual bounds before rollout.
- Lists, revisions, templates, exports, streams, project notifications, and worker actions can bypass a partial implementation. Cover all before enabling private defaults.
- No admin private-content bypass is proposed outside the existing trace policy. Ownership recovery must not become an undeclared bypass.

## Migration

1. Produce a read-only classification preview for agent artifacts, web agent sessions, channel sessions, and legacy prompt/evaluation sessions. Identify channels through trusted thread relations, not a creator ID.
2. Add schema without changing old permissions. Backfill agents to project visibility. Preserve creator attribution separately from owner.
3. Make an old web agent chat private only with independent evidence of an actual human creator who remains an active member. Otherwise keep project visibility. Leave prompts, evaluations, and their sessions unchanged.
4. Backfill channel artifact parents from verified references. Do not guess unresolved parents. Require parents for new threads.
5. Enable new private requests only after service, list, file, worker, and stream checks pass in OSS and EE. Record migration decisions and support idempotent restart.
6. Rollback must disable new private access paths rather than restore broad reads for resources already presented as private. Preserve additive columns until protected traffic is safely routed.
