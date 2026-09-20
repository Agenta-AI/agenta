# Design

Status: Draft for review. No implementation or live Slack validation is included. The channels stack has not shipped to production. No backward-compatibility layer or production data migration is required for its pre-release behavior.

## Context

See [proposal](proposal.md) for the user outcome and [evidence](../../evidence.md) for exact source references. The baseline is the effective channels stack through PR #6737 at `658d6f5edae34d861d141a38604ef7a12a7b69c8`.

The backend already permits several channel agents per installation. The shared desktop and mobile actions instead select one answering row and retarget its application reference. Grants are also edited through that selected row. Merely adding group creation would leave those actions modifying the wrong agent.

Core resolves a pending choice, then an active conversation, before its ordinary address lookup. The existing conversation helper only bypasses ownership for `~slug`. Native addressing therefore needs a change before these lookups, not only a new regular expression in the Slack adapter.

The outbox posts progress before the final answer and later edits that message. Its thread contains `agent_id`, but the adapter receives no sender profile. Sender customization must begin with the first post.

## Goals / Non-Goals

**Goals:** Build the first-release Slack experience using the existing installation, grants, session, and outbox foundations where useful. Keep failures visible. Change pre-release interfaces directly when that simplifies the implementation.

**Non-Goals:** Do not generalize all platform identities, introduce a second credential per agent, create a new deployment service, or implement organization-level native handles. Do not add arbitrary-avatar fetching. Telegram and bridge adapters keep their existing behavior.

## Decisions

### One installation and separate addresses

Keep `ChannelConnection` as the installation and credential owner. Add `channel_agent_addresses` with project, connection, channel-agent, Slack team, address kind, nullable external group ID during provisioning, handle, sender profile, ownership evidence, lifecycle state, sanitized error, and operation identity. Keep a created group ID even when verification fails.

Enforce unique external group ID per connection and team, unique managed handle per connection and team, and one address per channel agent, team, and kind. Use composite ownership checks so agent, address, and connection belong to the same project and connection. Preserve disabled records. They prevent stale mentions from reaching a default agent.

The deployment operation also needs a stable application-plus-connection key. Concurrent page requests must select the same channel agent, not create distinct agents before an address uniqueness check. A partial unique deployment key or equivalent database transaction constraint is sufficient. No importer or backfill for pre-release channel-agent rows is required.

Alternative: Store all fields in agent JSON. This avoids one table but makes immutable-ID routing, uniqueness, and tombstones harder to enforce. Alternative: Create an installation per agent. That discards the backend's existing shared relationship and changes the desired product model.

### Explicit provisioning with durable operation state

Run provisioning from an authenticated project-editor action. Persist a pending operation before the external call and serialize operations for its deployment key. Create the group without members or default channels, record the returned ID, then read it back before setting active.

The state path is `pending -> active` or `pending -> failed`. Suspension uses `failed` with a specific drift reason and blocks native routing. Removal immediately sets `pending-disable` and blocks local channel activity before the external disable call. Verified disablement sets `disabled`. Preserve the previous external ID across retries.

Slack group creation is not assumed to offer an idempotency key. A network timeout without a receipt is an unknown outcome. Stop automatic creation and expose an operator recovery step. A matching handle alone is insufficient proof that Agenta owns the object. Where a receipt exists, retry read-back by ID rather than create.

Reconcile recorded IDs when managing or retrying a deployment and before accepting native-address input. Bound and deduplicate those checks per address and respect Slack's retry delay. If a check is unavailable, delay processing or refuse that native turn rather than treat stale capability state as verified. Cache only verified state with an explicit bounded lifetime if live tests show rate pressure; do not claim immediate detection of changes made inside Slack.

Use `usergroups.list` with the fields needed for verification and filter its response to recorded group IDs. Slack can return unrelated groups in that read; do not persist or manage them. Alternative: A broad periodic Slack workspace sync is not needed for this release. Do not add a background system just for these specs.

### Installation scopes and eligibility

Extend the shared manifest and OAuth scope list with `usergroups:read`, `usergroups:write`, and `chat:write.customize`. Store or inspect the actual granted scopes returned by the authorization or verification path. Unknown permissions are not proof of eligibility.

Keep one bot token. Workspace policy can deny group management even when a scope is granted. Report the blocker instead of introducing user OAuth or altering workspace settings. Organization-level native deployment is outside this release. Use the receiving `team_id` in address keys to enforce workspace isolation.

Audit the existing manifest's event scopes as part of live setup. The reviewed list subscribes to `app_mention` but does not list `app_mentions:read`; do not assume that existing app-mention delivery is proven. Native group mentions arrive through ordinary message events and still require the app to receive messages in that conversation.

Alternative: Treat a successful OAuth callback as proof of readiness. Rejected because scope grants, plan eligibility, workspace policy, and channel membership are separate checks.

### Normalize native addresses before conversation selection

Add an optional normalized external-address collection to the inbound event contract. The Slack adapter extracts group IDs from `<!subteam^ID>` and `<!subteam^ID|label>` tokens. It must not convert visible labels into `~slug` strings or fabricate trusted internal agent IDs.

Resolve managed IDs with the verified connection, project, and receiving team. Ignore unrelated group mentions as agent addresses. A known non-active managed address stops selection. Several distinct managed agents produce an ambiguous-address outcome and no run. Repeated references to the same agent collapse to one target. Do not build a parallel `~slug` compatibility path.

For a valid native target, select that agent before `_agent_awaiting_answer` and `_agent_holding_thread` can claim the message for another agent. Pending-choice handling must remain bound to the selected agent and its original interaction. Native addressing does not grant permission to approve a tool call. For messages without a native target, select a matching pending-choice owner, then the active conversation, then the configured default. This is the intended first-release behavior, not a requirement to retain the current helper structure or parsing order.

After selection, use the existing sender restriction, agent status, grant, effective policy, session, and duplicate-event paths. Native mentions must satisfy mention-only admission rules without weakening command-only rules. A switch to another agent uses that agent's session association rather than moving the former agent's session.

Alternative: Only change `_addressed_agent`. Rejected because an existing conversation would win before that function runs.

### Resolve sender identity in the outbox

Resolve the trusted deployment profile using project, connection, and `thread.agent_id`. Extend the outbound contract directly and update its callers. Other adapters do not need Slack-specific identity behavior. Require a valid profile and customization permission for native deployment; surface missing permissions as a blocked delivery rather than add an old-bot fallback.

Snapshot the profile for the first post of a delivery. Include `username` and `icon_url` in every `chat.postMessage` chunk, including progress and approval cards. Do not put those fields into `chat.update`. Subsequent edits preserve the posted identity. Future new deliveries can use an edited profile.

Do not retry a timed-out post with a different identity, because it could duplicate an accepted message. Retain delivery receipts and safe retry handling. The current Slack adapter accepts an `idempotency_key` but does not send it; these specs do not assert exactly-once Slack posting.

Use project-edit authorization and public Agenta-managed assets. Name limits and image rules must follow Slack's current API limits. Do not allow an agent prompt to override the sender profile. Setup must explain that different names still belong to one app. This phase customizes replies to initiating user input, not proactive impersonation.

Alternative: Change the installation bot's profile for each reply. Rejected because concurrent agents would race over one global profile. Alternative: Customize only the final answer. Rejected because it cannot reliably change the identity already established by the progress post.

### Add deployment instead of retargeting

Replace the Slack path through `pointHere` with an idempotent deployment action. Resolve the current application rather than `answeringAgentRow` for permissions and removal. Leave Telegram's existing actions unchanged.

Keep a compact Slack card on the agent page. Add an explicit installation choice when needed and a roster in connection management. The page shows handle, state, authorization blockers, and actionable Slack errors. Keep connection allowed-users controls visibly shared. Show a separate installation-disconnect action with affected agents; do not reuse it for removing one deployment.

Preserve an existing default when another agent is added. Removing a default leaves it unset until an editor chooses a replacement. A native handle does not create a distinct Slack direct-message destination. Direct messages still reach the shared app and use existing conversation and default behavior, with explicit addressing where supported.

Alternative: Expose the backend roster without changing actions. Rejected because grant writes and removal would still operate on the default row or the whole installation.

## Risks / Trade-offs

- **Empty groups:** The API permits creation without a users parameter, but that alone does not prove Slack's autocomplete and mention behavior. Require a live test before enabling rollout. Do not use `usergroups.users.update` with an empty list; Slack explicitly disallows removing all members that way. If empty groups do not meet the requirement, stop the release and revise the proposal. Do not add human members silently.
- **External membership edits:** Slack can notify humans before Agenta sees an event. Suspending a drifted address prevents an agent response, not Slack's already-sent notification. Show that limitation to the operator.
- **Permissions and paid plans:** Scopes are necessary, not sufficient. Block native deployment with a useful explanation. No fallback product mode is required.
- **Message availability:** A user-group mention does not invite the app into a private channel. Live tests must include app membership and private-channel delivery.
- **Partial creation or removal:** Preserve receipts, state, and ownership. Never claim an unrelated group as recovery.
- **Rate limits:** Reconciliation adds reads. Measure the native routing path under expected traffic and respect `Retry-After`; do not silently discard admitted user input.
- **Shared app identity:** Reply names are cosmetic identities, not separate Slack users or security principals. Communicate that limit.
- **Approval and conversation ownership:** Explicitly test native switches in threads with open approvals. Do not let address resolution become approval authorization.

## First-Release Plan

1. Define the final schema, endpoints, adapter contract, and generated clients together. Database schema changes must follow repository tooling, but no production backfill, dual-read format, or pre-release state-preservation path is required.
2. Update hosted authorization and customer-owned manifests to request the final scopes on first installation.
3. Use fresh test installations. Reset or reinstall development connections only with operator approval; this design does not authorize deleting shared test data.
4. Validate event subscriptions and prove the live Slack release gates below.
5. Ship the backend and shared desktop/mobile controls together after acceptance. Provision managed groups only on an explicit editor action.
6. Retain safe failure handling and verified cleanup of groups created during tests. No rollback into the unreleased `~slug` product model is required.

## Verification Plan

Extend nearby adapter, service resolution, hosted lifecycle, grant, outbox, and shared-action tests listed in [evidence](../../evidence.md). Test two agents in the same installation and the same group ID under different connection/team keys. Test duplicate requests, timeouts after create, denied permissions, retries, disabled addresses, approval ownership, and removal of one agent.

Live Slack acceptance requires a paid test workspace, approved bot scopes and group permissions, and the app invited to test conversations. Verify empty-group autocomplete and mention delivery, no human memberships, two agent profiles, progress-to-answer identity, channel and direct-message behavior, permission failures, and removal. Save exact source SHA and sanitized evidence. No production Slack changes are authorized by these documents.

## Effort

| Component | Engineer-days |
| --- | ---: |
| Address schema and ownership checks | 1-2 |
| Installation scopes and eligibility | 1 |
| Provisioning, reconciliation, and recovery | 2-3 |
| Inbound routing and conversation selection | 1-2 |
| Outbound identity | 1-2 |
| Shared UI and deployment actions | 1-2 |
| Automated tests and live Slack checks | 2-3 |
| Total | 9-15 |

This estimate excludes backward-compatibility work, production data migration, app-review waiting time, and Enterprise Grid. Live Slack findings can change the scope. It is an estimate, not a delivery commitment.
