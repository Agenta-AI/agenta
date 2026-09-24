# Tasks

These tasks describe future implementation. All remain unchecked. Mahmoud approved creating the OpenSpec documents, not implementation. The channels stack has not shipped to production; no compatibility mode or migration of pre-release data is required.

## 1. Define tool and data contracts

- [ ] 1.1 Define DTOs for opaque destinations, action grants, delivery intents, delivery states, search queries, search coverage, and exact schedules; verify schema tests reject raw project, connection, channel-agent, and provider locator fields.
- [ ] 1.2 Add a runner-generated tool call identity to dispatch context and bind workflow artifact, variant, and revision references into channel operations; verify the model-visible schemas omit every bound field and one retry retains the same call identity.
- [ ] 1.3 Add the seven platform catalog operations with correct endpoint, schema, timeout, and read-only hints; verify platform resolver tests cover each operation and reject duplicate or unknown declarations.
- [ ] 1.4 Generate affected public clients and verify generated schemas match the authenticated Channels routes without credential fields.

## 2. Add action grants and destinations

- [ ] 2.1 Add `reply`, `search`, `send`, and `direct_message` actions to the pre-release Channels grant model; verify allow and deny evaluation at connection-kind and destination levels without treating reply as proactive send.
- [ ] 2.2 Resolve the bound run identity to active ChannelAgent deployments within the authenticated project; verify workflow, variant, and revision references, multiple authorized connections, ambiguous same-connection deployments, and cross-project refusal.
- [ ] 2.3 Project active ChannelSpace rows as opaque destinations and implement `list_channel_destinations`; verify results contain safe labels and capabilities but no raw Slack channel, Slack user, Telegram chat, connection, or credential fields.
- [ ] 2.4 Re-check destination authority on every operation; verify copied, revoked, archived, unverified, and other-project destination IDs fail without metadata disclosure.

## 3. Implement durable delivery

- [ ] 3.1 Add ChannelDeliveryIntent storage, lifecycle states, attempt records, unique tool-invocation constraint, sanitized failures, and receipts; verify fresh database and concurrent duplicate-enqueue tests.
- [ ] 3.2 Implement `ChannelsService.enqueue_output` for tool-originated delivery and verify repeated calls with one tool invocation identity return one intent.
- [ ] 3.3 Implement `ChannelsService.deliver` with claim, current authorization, trusted sender profile, adapter post, receipt transition, and blocked state; verify grant or credential revocation prevents the external call.
- [ ] 3.4 Implement `send_channel_message` and `get_channel_delivery`; verify immediate success, provider rejection, queued timeout, unknown provider outcome, retry, and long-message chunk receipts.
- [ ] 3.5 Route the final provider-call part of turn replies through the same delivery primitive without changing progress folding; verify existing Slack, Telegram, bridge, mock, approval, and outbox suites.
- [ ] 3.6 Expose at-least-once provider semantics and unknown outcomes; fault-inject a lost Slack receipt and verify the system does not claim exactly-once delivery or enqueue a second local intent.

## 4. Add explicit direct-message destinations

- [ ] 4.1 Add editor-only Slack recipient authorization and direct-conversation setup with `im:write`; verify raw model-supplied user IDs cannot open a conversation and missing scope or workspace access produces a safe blocker.
- [ ] 4.2 Persist the resolved direct conversation as a private destination with agent-specific grants; verify another agent or project cannot list or use it.
- [ ] 4.3 Create or select a private ChannelThread and session for proactive direct-message continuity; verify the source session and its history are not moved or copied.
- [ ] 4.4 Route a recipient reply to the private session under current grants; verify revocation, agent disablement, and shared-installation defaults do not attach it to the source channel session.
- [ ] 4.5 Validate Slack direct-message setup and reply continuity in an approved test workspace; save sanitized scopes, payloads, source SHA, and results.

## 5. Build permission-aware search

- [ ] 5.1 Add the tenant-scoped lexical message projection and deterministic cursor indexes; verify messages with equal timestamps paginate without duplicates or omissions.
- [ ] 5.2 Project valid inbound events without starting extra turns; verify Slack new, changed, and deleted events update one stable searchable record and bot echoes remain excluded from invocation.
- [ ] 5.3 Add Slack live indexing and bounded paginated backfill for selected destinations; verify private membership failures, retention gaps, retry delays, interrupted resume, and coverage persistence.
- [ ] 5.4 Record Telegram observed-history coverage without discovery or backfill; verify searches before the first retained event return an explicit unavailable range.
- [ ] 5.5 Implement `search_channel_messages` with query-time project, deployment, destination, and grant checks; verify revoked and other-project indexed content remains inaccessible.
- [ ] 5.6 Return safe sender data, opaque thread references, permitted links, deterministic cursors, and coverage; verify raw provider identifiers and inaccessible permalinks are omitted.
- [ ] 5.7 Run PostgreSQL search tests and approved live Slack checks for public, invited-private, thread, edit, delete, rate-limit, and incomplete-history cases; save sanitized evidence.

## 6. Implement exact and recurring schedules

- [ ] 6.1 Implement `schedule_channel_message` with offset-aware RFC 3339 validation and normalized UTC storage; verify missing offsets, past times, duplicate calls, and unauthorized destinations are refused.
- [ ] 6.2 Implement `list_scheduled_channel_messages` and `cancel_scheduled_channel_message`; verify owner scoping, project isolation, idempotent cancellation, and sent-message non-recall behavior.
- [ ] 6.3 Connect due intents to the existing scheduling service or its delivery wake-up path; verify duplicate due events claim one intent and adapters receive no cron or timing logic.
- [ ] 6.4 Re-check deployment, connection, destination, scope, and action grants at due time; verify revoked schedules become blocked without a provider call.
- [ ] 6.5 Exercise a recurring generated report through the existing agent scheduler and ordinary send tool; verify denied or interactive-only send permission stops the unattended post instead of bypassing approval.

## 7. Add configuration and observability controls

- [ ] 7.1 Add agent-editor controls for each optional channel tool and its runner permission; verify connecting an agent does not silently enable any tool.
- [ ] 7.2 Add destination action controls for search, proactive send, and direct-message access; verify desktop and mobile show the same effective capabilities and blockers.
- [ ] 7.3 Add delivery, schedule, search coverage, and sanitized failure views; verify users can distinguish queued, sending, sent, failed, blocked, cancelled, incomplete, and unknown outcomes.
- [ ] 7.4 Add audit records linking bound run, tool invocation, policy decision, destination, delivery or query, and receipt; verify credentials and unredacted provider errors never appear.

## 8. Validate the proposed release

- [ ] 8.1 Run focused SDK platform-tool, runner, Channels route, policy, database, adapter, outbox, scheduler, and shared UI suites; record exact commands, source SHA, and results.
- [ ] 8.2 Run an approved end-to-end flow from Agenta chat, Slack, Telegram, and a scheduled run; verify destination listing, permission refusal, proactive send, direct-message continuity, search coverage, exact cancellation, and recurring generation.
- [ ] 8.3 Verify a fresh Slack installation requests all scopes needed by both approved Channels changes, including `im:write`, and verify first installation grants no agent tool authority automatically.
- [ ] 8.4 Run `openspec validate --all --strict --no-interactive`, local link and requirement checks, and `git diff --check`; archive the change only after implementation, live validation, and product acceptance are complete.
