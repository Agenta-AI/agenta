# Channel agent tools: implementation plan

**Goal:** Let an agent connected to Slack or Telegram list where it can post, post there, read a channel's history, and search its channels' stored messages, under per-bot settings.

**Architecture:** Four endpoint-mode platform tools call new authenticated routes under `/api/channels/tools/`. They belong to the Agenta tools kit, which activates them when the agent is connected to a bot, and the send tool defaults to `allow`. A `ChannelToolsService` in `api/oss/src/core/channels/tools/` resolves the agent's bots, applies the bot settings on every call, posts through the existing outbox and adapters, reads stored inbox and outbox rows with live Slack history for older messages, and searches stored inbox rows through a full-text expression index. No new message table.

**Tech stack:** Python 3 with FastAPI, Pydantic, SQLAlchemy, and Alembic (API); PostgreSQL full-text search; httpx against the Slack Web API and the Telegram Bot API; TypeScript with Vitest (runner); React with Vitest and Storybook (`@agenta/settings-ui`).

Read [design.md](design.md) first. Each phase ships as its own pull request, in this order.

| Phase | Scope | Tasks | Size |
| --- | --- | ---: | --- |
| 1 | Destinations, bot settings, list tool, kit condition | 8 (6 without DMs) | M, 2-3 days (+1 with DMs) |
| 2 | Send tool, delivery record, tool call ID, `allow` default | 8 (6 without DMs) | M-L, 3-4 days (+1 with DMs) |
| 3 | Settings UI: the Advanced section | 3 | S, 1-2 days |
| 4 | Read tool: stored messages, then live Slack history | 5 | M, 2-3 days |
| 5 | Search tool over stored messages | 2 | S-M, 1-2 days |
| | Live QA and fixes | | 2-3 days |
| | **Total** | | **11-17 days without DMs, 13-19 with DMs** |

Tasks marked **pending decision** exist only if direct messages to people stay in v1. Skip them if Mahmoud leaves direct messages out. Nothing else depends on them.

Phases 1 and 2 give the agent a working send path. Phase 3 gives admins the switches. Phase 3 depends only on phase 1, so it can merge before phase 2. It must not ship in a later release than phase 2: the send tool posts without a prompt, so admins need the posting switch from the first day it exists. Phases 4 and 5 add reading and searching.

## Conventions used in every task

Commands run from the repository root unless a `cd` is shown.

- **API unit test:** `cd api && uv run --no-sync python run-tests.py <path>[::<test>]`. Run `uv sync --locked` once first.
- **API integration test** (needs the local Postgres; see `hosting/AGENTS.md`): `load-env hosting/docker-compose/oss/.env.oss.dev`, then `cd api && uv run --no-sync python run-tests.py <path>[::<test>]`.
- **SDK unit test:** `cd sdks/python && uv run --no-sync python run-tests.py <path>[::<test>]`.
- **Runner unit test:** `cd services/runner && pnpm vitest run --project unit <path>`.
- **Settings UI unit test:** `cd web/packages/agenta-settings-ui && pnpm vitest run <path>`.
- **Before each commit:** `cd api && ruff format && ruff check --fix` for API changes. Do the same in `sdks/python` for SDK changes. Run `cd web && pnpm lint-fix` for web and runner changes. In a GitButler workspace, commit with `but commit <branch> -m "<message>"`. Otherwise use `git commit -m "<message>"`.
- New API unit tests for the tool service live in a new package, `api/oss/tests/pytest/unit/channels/tools/`, with an empty `__init__.py`. Reuse the in-memory DAO pattern from `api/oss/tests/pytest/unit/channels/test_channels_outbox_worker.py` and the fake adapter in `api/oss/tests/pytest/unit/channels/contract/fakes.py`.
- Migration numbers below assume `oss000000035` is still the head of `api/oss/databases/postgres/migrations/core_oss/versions/`. Take the next free number at implementation time.

Every task follows five steps: (1) write the failing test, (2) run it and see it fail, (3) implement, (4) run it and see it pass, (5) commit. When the run command is the same for steps 2 and 4, it is written once.

---

## Phase 1: Destinations, bot settings, and the list tool

PR title: `feat(api): channel destinations and the list_channel_destinations tool`. Size: M, 8 tasks (6 without DMs), about 2-3 days, plus 1 day with DMs.

### Task 1.1: Bot settings block

- Modify: `api/oss/src/core/channels/dtos.py` (add `ChannelAgentToolSettings` with `can_post_outside_conversation: bool = True`, `can_message_people: bool = True`, `readable_space_ids: Optional[List[UUID]] = None`; add `tools: ChannelAgentToolSettings` to `ChannelAgentData` and `tools: Optional[ChannelAgentToolSettings]` to `ChannelAgentDataEdit`), `api/oss/src/core/channels/service.py` (`_layer_agent_edit` layers `tools`).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_agent_tool_settings.py`.

1. Write `test_agent_data_without_tools_reads_defaults` (a `ChannelAgentData` built from `{"references": {...}}` has both switches on and `readable_space_ids is None`), `test_edit_tools_keeps_references_and_policy` (layering a `tools` edit leaves `references` and `policy` unchanged), and `test_edit_without_tools_keeps_stored_tools`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_agent_tool_settings.py`. It fails with an attribute error on `tools`.
3. Add the model and the layering.
4. Run the same command. It passes. Also run `oss/tests/pytest/unit/channels/test_channels_edit_semantics.py` and `test_channels_dtos.py`.
5. Commit: `feat(api): add channel tool settings to ChannelAgentData`.

### Task 1.2: People table (pending decision)

Only if direct messages to people stay in v1.


- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000036_add_channel_people.py` (table `channel_people`: `project_id`, `id`, `connection_id`, `external_key` string, `space_id` nullable, `name`, `handle`, `flags` JSONB, lifecycle columns; unique `(project_id, connection_id, external_key)`; index on `(project_id, connection_id, lower(name))`).
- Modify: `api/oss/src/core/channels/dtos.py` (`ChannelPerson`, `ChannelPersonCreate`, `ChannelPersonQuery`), `api/oss/src/core/channels/interfaces.py` (`upsert_people`, `query_people`, `fetch_person`, `link_person_space`), `api/oss/src/dbs/postgres/channels/dbas.py`, `dbes.py`, `mappings.py`, `dao.py`.
- Test: create `api/oss/tests/pytest/integration/channels/test_channels_dao_people.py`, using the `channels_scope` fixture from `integration/channels/conftest.py`.

1. Write `test_upsert_people_is_idempotent_on_external_key` (the same key twice leaves one row and updates the name), `test_query_people_filters_by_name_prefix_case_insensitively`, `test_query_people_pages_with_cursor`, and `test_people_are_project_scoped` (a second project sees nothing).
2. Run `load-env hosting/docker-compose/oss/.env.oss.dev`, then `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_people.py`. It fails because the table is missing.
3. Add the migration, entity, mappings, and DAO methods. Apply the migration to the local stack with `bash ./hosting/docker-compose/run.sh --oss --dev --build`. Note that `--recreate api` alone does not migrate.
4. Run the same command. It passes.
5. Commit: `feat(api): add the channel_people table`.

### Task 1.3: Slack member channels (and people, pending decision)

The people half (`list_people`, its fake, and its two tests) exists only if direct messages stay in v1.


- Modify: `api/oss/src/core/channels/adapters/interface.py` (add `list_member_spaces(connection, cursor)` and `list_people(connection, cursor)`, both returning a page and a next cursor; the default raises `ChannelNotSupported`), `api/oss/src/core/channels/dtos.py` (add `ChannelDirectory` capability with `member_spaces: bool`, `people: bool`, `open_direct: bool`; add it to `ChannelCapabilities`), `api/oss/src/core/channels/adapters/slack/adapter.py` (page `users.conversations` with `types=public_channel,private_channel` and `users.list`; skip `is_bot`, `deleted`, and `USLACKBOT`), `adapters/slack/capabilities.py` (declare all three), `adapters/telegram/capabilities.py` (declare none), and `adapters/mock/adapter.py`.
- Modify: `api/oss/tests/pytest/unit/channels/slack/fake_slack.py` (answer `users.conversations` and `users.list` with paging).
- Test: create `api/oss/tests/pytest/unit/channels/slack/test_slack_directory.py`. Extend `api/oss/tests/pytest/unit/channels/telegram/test_telegram_adapter.py`.

1. Write `test_list_member_spaces_follows_cursor_and_skips_group_dms`, `test_list_people_skips_bots_deleted_and_slackbot`, `test_list_people_returns_name_and_handle_without_email`, and, in the Telegram file, `test_telegram_declares_no_directory`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_directory.py`. It fails because the method is missing.
3. Implement the adapter methods and extend the fake.
4. Run the same command, the Telegram file, and `oss/tests/pytest/unit/channels/slack/test_slack_contract_suite.py`. All pass.
5. Commit: `feat(api): list Slack member channels and workspace people`.

### Task 1.4: Opaque destination IDs

- Create: `api/oss/src/core/channels/tools/__init__.py`, `api/oss/src/core/channels/tools/destinations.py` (`encode_destination_id(kind, row_id)` and `decode_destination_id(value)`, which returns `None` for anything malformed).
- Test: create `api/oss/tests/pytest/unit/channels/tools/__init__.py` and `test_destination_ids.py`.

1. Write `test_destination_id_round_trips_for_channel_and_person`, `test_malformed_destination_id_decodes_to_none` (empty, wrong prefix, bad UUID, a raw Slack ID such as `C0123`), and `test_destination_id_contains_no_provider_identifier`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_destination_ids.py`. It fails on import.
3. Implement the codec.
4. Run the same command. It passes.
5. Commit: `feat(api): opaque channel destination ids`.

### Task 1.5: Match the run to its bots

- Create: `api/oss/src/core/channels/tools/service.py` (`ChannelToolsService.resolve_bots(project_id, artifact_id)` returns the matching `(ChannelAgent, ChannelConnection)` pairs), `api/oss/src/core/channels/tools/types.py` (`ChannelToolsNoBot`, `ChannelToolsAmbiguousBot`, `ChannelToolsRefused`, `ChannelToolsNotFound`).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_resolve_bots.py`.

1. Write `test_matches_application_reference`, `test_matches_workflow_reference`, `test_matches_variant_reference_through_its_artifact` (with a stubbed workflows lookup), `test_skips_archived_inactive_and_unverified_connections`, `test_two_bots_on_one_connection_raise_ambiguous`, `test_bots_on_two_connections_both_match`, and `test_no_match_returns_empty`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_resolve_bots.py`. It fails on import.
3. Implement the matcher. Look up variant and revision artifacts through the workflows service that `api/entrypoints/routers.py` already builds.
4. Run the same command. It passes.
5. Commit: `feat(api): resolve a run's channel bots from its workflow artifact`.

### Task 1.6: `list_destinations`

The person cases (people in the list, the direct-message setting, and person rows created on inbound private messages) exist only if direct messages stay in v1.


- Modify: `api/oss/src/core/channels/tools/service.py` (`list_destinations`, `_sync_slack_directory` with a time-to-live stored in `ChannelConnection.data["directory_synced_at"]`), `api/oss/src/core/channels/tools/dtos.py` (create: `ChannelDestination`, `ChannelDestinationQuery`, `ChannelDestinationsPage`), `api/oss/src/core/channels/service.py` (create or link a person row when a private message arrives, inside `resolve`), `api/oss/src/utils/env.py` (`env.channels.tools.directory_ttl_seconds`, default 300).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_list_destinations.py`.

1. Write `test_slack_lists_member_channels_and_people`, `test_posting_off_marks_channels_not_postable_and_hides_people`, `test_direct_messages_off_hides_people`, `test_readable_list_sets_can_read_per_channel`, `test_second_call_within_ttl_does_not_call_slack`, `test_telegram_lists_groups_and_private_chat_people_only`, `test_telegram_result_carries_the_limits_note`, `test_hosted_telegram_lists_only_this_projects_bindings`, and `test_private_spaces_are_never_channel_destinations`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_list_destinations.py`. It fails.
3. Implement the listing, the sync, and person creation on inbound private messages.
4. Run the same command, plus `oss/tests/pytest/unit/channels/test_channels_service_routing.py`. Both pass.
5. Commit: `feat(api): list a connected agent's channel destinations`.

### Task 1.7: Tool router and SDK catalog entry

- Create: `api/oss/src/apis/fastapi/channels/tools.py` (`ChannelToolsRouter` with `POST /tools/destinations/query`; every handler checks `Permission.RUN_CHANNELS`; request models use `extra="forbid"`).
- Modify: `api/oss/src/apis/fastapi/channels/models.py`, `api/entrypoints/routers.py` (build `ChannelToolsService` and mount the router under `/channels` next to `ChannelsRouter`), `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `list_channel_destinations`: `POST /api/channels/tools/destinations/query`, `read_only=True`, `context_bindings={"workflow.artifact_id": "$ctx.workflow.artifact.id"}`, closed input schema; add a `CHANNEL_TOOL_OPS` tuple that later phases extend).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_tools_router.py` (the mocked-request pattern of `test_channels_router.py`) and `sdks/python/oss/tests/pytest/unit/agents/platform/test_channel_ops.py`.

1. Write `test_tools_routes_require_run_channels`, `test_destinations_query_rejects_unknown_fields`, `test_destinations_response_has_no_raw_provider_ids`, and, in the SDK file, `test_list_channel_destinations_is_read_only_and_hides_artifact_binding`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_tools_router.py` and `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/platform/test_channel_ops.py`. Both fail.
3. Implement the router, the wiring, and the catalog entry.
4. Run both commands, plus `oss/tests/pytest/unit/agents/platform/test_op_catalog.py` in the SDK. All pass.
5. Commit: `feat(api,sdk): expose list_channel_destinations as a platform tool`.

### Task 1.8: The condition the Agenta tools kit reads

The Agenta tools kit specification (`docs/agenta-tools-kit`) owns how the channel tools are added to a run and turned off. This task only gives the kit its condition: is this agent connected to an active, verified bot? If the kit specification defines a different way to ask, follow it and keep the service method.

- Modify: `api/oss/src/core/channels/tools/service.py` (`is_available(project_id, artifact_id)` reuses `resolve_bots` from task 1.5), `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/availability` returns `{"available": bool}`), `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (`CHANNEL_TOOL_OPS` is the list the kit reads for its channel group).
- Test: extend `api/oss/tests/pytest/unit/channels/tools/test_resolve_bots.py` and `api/oss/tests/pytest/unit/channels/test_channels_tools_router.py`.

1. Write `test_is_available_true_for_active_verified_bot`, `test_is_available_false_after_disconnect_or_archive`, and, in the router file, `test_availability_requires_run_channels`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_resolve_bots.py`. The new cases fail.
3. Implement.
4. Run the same command and the router test. Both pass.
5. Commit: `feat(api): tell the tools kit when an agent is connected to a bot`.

---

## Phase 2: The send tool and the delivery record

PR title: `feat(api): send_channel_message with a durable delivery record`. Size: M-L, 8 tasks (6 without DMs), about 3-4 days, plus 1 day with DMs.

### Task 2.1: Tool call ID in the runner's run context

- Modify: `services/runner/src/protocol.ts` (add `tool?: { call_id?: string }` to `RunContext`), `services/runner/src/tools/relay.ts` (in `executeAllowedRelayedTool`, pass `{ ...runContext, tool: { call_id: req.toolCallId } }` to `assembleBody` and `applyContextBindings`; make sure `redactContextBoundArgs` keeps it out of approval keys).
- Test: modify `services/runner/tests/unit/tool-callref-bindings.test.ts`.

1. Write `it("binds $ctx.tool.call_id from the relayed tool call on a direct call")` (the request body holds the relayed ID), `it("keeps the same tool.call_id when the same call is relayed twice")`, and `it("leaves tool.call_id out of the approval key")`.
2. Run `cd services/runner && pnpm vitest run --project unit tests/unit/tool-callref-bindings.test.ts`. The new cases fail.
3. Implement.
4. Run the same command, plus `tests/unit/tool-direct.test.ts`. Both pass.
5. Commit: `feat(runner): bind the tool call id into direct-call run context`.

### Task 2.2: Outbox rows without a thread

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000037_extend_channel_outbox_for_tools.py` (`thread_id` nullable; add `space_id` UUID and `origin` string defaulting to `turn`; fill `space_id` from each row's thread).
- Modify: `api/oss/src/core/channels/dtos.py` (`ChannelOutboxEvent.thread_id: Optional[UUID]`, add `space_id`, `origin: ChannelOutboxOrigin`), `api/oss/src/dbs/postgres/channels/dbas.py`, `mappings.py`, `dao.py`.
- Test: modify `api/oss/tests/pytest/integration/channels/test_channels_dao_outbox.py`.

1. Write `test_tool_origin_row_without_thread_round_trips` and `test_duplicate_tool_key_returns_existing_row`.
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_outbox.py`. The new cases fail.
3. Implement and apply the migration.
4. Run the same command, plus `oss/tests/pytest/integration/channels/test_channels_outbox_worker_integration.py`. Both pass.
5. Commit: `feat(api): let channel outbox rows target a space without a thread`.

### Task 2.3: Move delivery into `ChannelsService.deliver`

- Modify: `api/oss/src/core/channels/service.py` (replace the `deliver` stub with the claim, post, and receipt logic and the `delivery_uncertain` rule, returning `ChannelDeliveryOutcome` of `sent`, `failed`, or `unknown`), `api/oss/src/tasks/asyncio/channels/outbox.py` (`_deliver` and `_claim_delivery` call the service).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_service_deliver.py`. The existing `test_channels_outbox_worker.py` must pass unchanged.

1. Write `test_deliver_returns_sent_with_receipt`, `test_deliver_returns_unknown_on_read_timeout_and_never_retries`, `test_deliver_returns_failed_on_4xx`, and `test_deliver_reports_unknown_for_a_stale_claim_without_receipt`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_service_deliver.py`. It fails with `NotImplementedError`.
3. Move the logic. Keep the worker's behavior identical.
4. Run the same command, plus `oss/tests/pytest/unit/channels/test_channels_outbox_worker.py`. Both pass.
5. Commit: `refactor(api): move channel delivery into ChannelsService.deliver`.

### Task 2.4: Send to a channel

- Modify: `api/oss/src/core/channels/tools/service.py` (`send_message`: resolve the bot and destination, check the settings, validate that `thread_id` belongs to the destination, write or reuse the outbox row keyed `uuid5(session_id + tool_call_id)`, call `ChannelsService.deliver`, return the outcome), `api/oss/src/core/channels/tools/dtos.py` (`ChannelSendRequest`, `ChannelSendResult`).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_send_message.py`.

1. Write `test_posting_off_refuses_without_calling_the_adapter`, `test_thread_from_another_destination_is_refused`, `test_retry_with_same_tool_call_returns_first_outcome`, `test_unknown_outcome_is_returned_and_not_reposted`, `test_revoked_credential_fails_and_switches_connection_off`, `test_sent_result_has_message_and_thread_ids`, and `test_archived_connection_is_refused`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_send_message.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): send a channel message from any agent run`.

### Task 2.5: Send to a person with a private session (pending decision)

Only if direct messages to people stay in v1.


- Modify: `api/oss/src/core/channels/adapters/interface.py` and `adapters/slack/adapter.py` (`open_direct_conversation(connection, person_locator)` calls `conversations.open`), `api/oss/tests/pytest/unit/channels/slack/fake_slack.py` (answer `conversations.open`), `api/oss/src/core/channels/tools/service.py` (person path: find or create the private space and link it on the person row; find the agent's active thread there or create one with `session_id=str(uuid4())`; set `thread_id` on the outbox row), `api/oss/src/core/channels/service.py` (`compose_input` adds the thread's unseen tool-origin outbox rows as the agent's earlier message).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_send_direct_message.py` and `api/oss/tests/pytest/unit/channels/test_channels_compose_proactive_message.py`. Extend `slack/test_slack_directory.py`.

1. Write `test_open_direct_conversation_calls_conversations_open` (Slack file), `test_slack_person_send_opens_conversation_and_creates_private_thread`, `test_existing_active_private_thread_is_reused`, `test_source_session_is_not_linked_or_copied`, `test_telegram_person_without_private_chat_is_not_found`, `test_direct_messages_off_refuses_person_send`, and `test_next_private_turn_includes_the_sent_text_once`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_send_direct_message.py` and `oss/tests/pytest/unit/channels/test_channels_compose_proactive_message.py`. Both fail.
3. Implement.
4. Run both commands, plus `oss/tests/pytest/unit/channels/test_channels_service_routing.py` and `test_channels_fill.py`. All pass.
5. Commit: `feat(api): proactive direct messages use their own private session`.

### Task 2.6: Slack messages tab (pending decision)

Only if direct messages to people stay in v1, since it lets people answer a direct message.


- Modify: `api/oss/src/core/channels/adapters/slack/manifest.py` (add `features.app_home` with `messages_tab_enabled: true` and `messages_tab_read_only_enabled: false`).
- Test: modify `api/oss/tests/pytest/unit/channels/slack/test_slack_manifest.py`.

1. Write `test_manifest_lets_people_reply_in_the_messages_tab`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_manifest.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `fix(api): enable the Slack messages tab so people can answer the bot`.

### Task 2.7: The `allow` default for the send tool

Express the default the way the Agenta tools kit expresses per-tool defaults. If the kit has no mechanism when this phase starts, add the smallest one below. Either way, the four precedence tests must pass.


- Modify: `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `default_permission: Optional[Literal["allow", "ask"]] = None` to `PlatformOp`, next to `read_only` at line 191), `sdks/python/agenta/sdk/agents/tools/interfaces.py` (`PlatformToolResolver.resolve` gains a `permission_default` keyword), `sdks/python/agenta/sdk/agents/tools/resolver.py` (pass `permission_default` at line 340), `sdks/python/agenta/sdk/agents/platform/platform_tools.py` (at line 130 emit `tool_config.permission` when set, else `op.default_permission` only when `permission_default == "allow_reads"`, else `None`).
- Test: create `sdks/python/oss/tests/pytest/unit/agents/platform/test_platform_default_permission.py`.

1. Write `test_op_default_applies_when_author_set_nothing_under_allow_reads` (a test op with `default_permission="allow"` resolves with `permission == "allow"`), `test_author_ask_wins_over_op_default`, `test_author_deny_wins_over_op_default`, `test_agent_wide_ask_mode_ignores_op_default` (the spec permission is `None`, so the runner applies `ask`), and `test_ops_without_default_are_unchanged`.
2. Run `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/platform/test_platform_default_permission.py`. It fails because the field is unknown.
3. Implement.
4. Run the same command, plus `oss/tests/pytest/unit/agents/platform/test_op_catalog.py` and `oss/tests/pytest/unit/agents/tools/test_permission_parity.py`. All pass.
5. Commit: `feat(sdk): per-operation default permission for platform tools`.

### Task 2.8: Send route and SDK catalog entry

- Modify: `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/messages/send`), `api/oss/src/apis/fastapi/channels/models.py`, `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `send_channel_message`, `read_only=False`, `default_permission="allow"`, binding `workflow.artifact_id`, `session_id` from `$ctx.session.id`, and `tool_call_id` from `$ctx.tool.call_id`; text `maxLength` 40,000; add it to `CHANNEL_TOOL_OPS`).
- Test: extend `api/oss/tests/pytest/unit/channels/test_channels_tools_router.py` and `sdks/python/oss/tests/pytest/unit/agents/platform/test_channel_ops.py`.

1. Write `test_send_rejects_username_and_icon_fields` and `test_send_returns_sanitized_reason_without_token` (router), and `test_send_channel_message_is_a_write_and_hides_session_and_tool_call` and `test_send_channel_message_defaults_to_allow` (SDK).
2. Run both files with the commands from task 1.7. The new cases fail.
3. Implement.
4. Run both files. They pass.
5. Commit: `feat(api,sdk): expose send_channel_message as a platform tool`.

---

## Phase 3: Settings UI

PR title: `feat(frontend): channel tool settings in the Advanced section`. Size: S, 3 tasks, about 1-2 days.

### Task 3.1: Client and actions

- Regenerate the TypeScript client against an EE stack so `ChannelAgentData.tools` is typed: `bash ./clients/scripts/generate.sh --language typescript --openapi-url http://localhost/api/openapi.json`.
- Modify: `web/packages/agenta-settings-ui/src/channels/types.ts` (`ChannelToolSettings`; `ChannelsActions.readToolSettings`, `writeToolSettings`, `listMemberChannels`), `src/channels/actions.ts` (read through `fetchChannelAgent`, write through `editChannelAgent` with only `data.tools`), `src/channels/helpers.ts` (`NOOP_ACTIONS`).
- Test: create `web/packages/agenta-settings-ui/tests/unit/channelToolSettings.test.ts`.

1. Write `it("reads the defaults when the bot has no tools block")`, `it("writes only data.tools")`, and `it("lists only channels the bot is a member of")`.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelToolSettings.test.ts`. It fails.
3. Implement.
4. Run the same command, plus `pnpm types:check`. Both pass.
5. Commit: `feat(frontend): channel tool settings actions`.

### Task 3.2: The Advanced section

- Create: `web/packages/agenta-settings-ui/src/channels/ChannelAdvancedSection.tsx`.
- Modify: `src/channels/ChannelManagePanel.tsx` (render the section last, collapsed by default), `src/channels/index.ts`.
- Test: create `web/packages/agenta-settings-ui/tests/unit/channelAdvancedSection.test.tsx` (the `@agenta/ui/ui` mock pattern of `channelManagePanel.test.tsx`).

1. Write `it("shows every switch on and All channels by default")`, `it("disables Can message people directly while posting is off")` (pending decision: only if direct messages stay), `it("saves only the checked channels under Only these channels")`, `it("shows the error and the stored value after a failed save")`, and `it("explains the Telegram limits under each control")`.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelAdvancedSection.test.tsx`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(frontend): Advanced section with channel tool settings`.

### Task 3.3: Update the old guard test and add stories

- Modify: `web/packages/agenta-settings-ui/tests/unit/channelManagePanel.test.tsx`. The test `shows no read-only settings: no Advanced defaults and no Status row` forbids the word "Advanced". Keep its intent: no read-only defaults and no Status row. Change it to assert that the Advanced section holds only editable controls.
- Modify: `src/channels/ChannelManagePanel.stories.tsx` (Slack default, Slack narrowed, Telegram, posting off).

1. Edit the test so it fails against the old panel and describes the new rule.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelManagePanel.test.tsx`.
3. Add the stories.
4. Run the same command and `pnpm types:check`. Both pass. Then run `cd web && pnpm lint-fix`.
5. Commit: `test(frontend): the Advanced section holds only editable channel settings`.

---

## Phase 4: The read tool

PR title: `feat(api): read_channel_messages over stored and live Slack history`. Size: M, 5 tasks, about 2-3 days.

### Task 4.1: Provider time and message reference on stored messages

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000038_add_channel_inbox_sent_at.py` (nullable `sent_at` timestamp column on `channel_inbox_events`; index `(project_id, space_id, sent_at, id)`; expression index `(project_id, space_id, (data #>> '{external_locator,thread_ts}'))`).
- Modify: `api/oss/src/core/channels/dtos.py` (`ChannelInboxEventProcessed.sent_at` and `message_ref`; `ChannelInboxEvent.sent_at`), `api/oss/src/dbs/postgres/channels/dbas.py`, `mappings.py`, `dao.py` (write `sent_at` from `processed.sent_at`), `api/oss/src/core/channels/adapters/slack/adapter.py` (`parse_event` and `fetch_history` set `sent_at` and `message_ref` from `ts`), `api/oss/src/core/channels/adapters/telegram/adapter.py` (`parse_event` sets them from `date` and `message_id`).
- Test: extend `api/oss/tests/pytest/unit/channels/slack/test_slack_adapter.py`, `api/oss/tests/pytest/unit/channels/telegram/test_telegram_adapter.py`, and `api/oss/tests/pytest/integration/channels/test_channels_dao_inbox.py`.

1. Write `test_parse_event_records_ts_as_sent_at_and_message_ref` (Slack), `test_fetch_history_records_ts_on_pulled_events` (Slack), `test_parse_event_records_date_and_message_id` (Telegram), and `test_inbox_event_round_trips_sent_at` (integration).
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_adapter.py`, then the Telegram file, then (after `load-env`) the integration file. The new cases fail.
3. Implement and apply the migration.
4. Run the three commands again. They pass.
5. Commit: `feat(api): record provider time and message reference on channel messages`.

### Task 4.2: Stored message read

- Modify: `api/oss/src/core/channels/interfaces.py` and `api/oss/src/dbs/postgres/channels/dao.py` (`query_space_messages(project_id, space_id, thread_ts, before, limit)`: inbox rows of the space, skipping `action` events and rows with `flags.is_consumed` once pull request #7128 lands, merged with sent outbox rows found through `thread.space_id` or the new `space_id`; ordered by `coalesce(sent_at, created_at)` and `id`; a bot post present in both is kept once, matched on the Slack `ts` or Telegram `message_id`).
- Test: create `api/oss/tests/pytest/integration/channels/test_channels_dao_space_messages.py`.

1. Write `test_merges_people_and_bot_posts_in_provider_order`, `test_bot_post_in_both_sources_appears_once`, `test_thread_filter_returns_root_and_replies`, `test_before_cursor_pages_older_without_gaps`, `test_rows_without_sent_at_fall_back_to_created_at`, and `test_action_events_are_skipped`.
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_space_messages.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): read a channel's stored messages from inbox and outbox`.

### Task 4.3: Live Slack history page

- Modify: `api/oss/src/core/channels/adapters/interface.py` (`fetch_history_page(connection, locator, latest, limit)` returns messages, including bot messages, with their `ts`; the default raises `ChannelNotSupported`), `api/oss/src/core/channels/adapters/slack/adapter.py` (call `conversations.history` or `conversations.replies` with `latest` and `inclusive=false`; on HTTP 429 raise `ChannelRateLimited` with the `Retry-After` seconds), `api/oss/src/core/channels/types.py` (`ChannelRateLimited`), `api/oss/tests/pytest/unit/channels/slack/fake_slack.py` (`latest` and a scripted 429).
- Test: create `api/oss/tests/pytest/unit/channels/slack/test_slack_history_pages.py`.

1. Write `test_history_page_returns_only_messages_before_latest`, `test_replies_page_returns_root_and_replies`, `test_429_raises_rate_limited_with_retry_after`, `test_missing_scope_raises_backfill_refused`, and `test_deleted_messages_are_absent_from_live_pages`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_history_pages.py`. It fails.
3. Implement.
4. Run the same command, plus `oss/tests/pytest/unit/channels/slack/test_slack_over_fake.py`. Both pass.
5. Commit: `feat(api): fetch one page of older Slack history before a timestamp`.

### Task 4.4: `read_messages` service

- Modify: `api/oss/src/core/channels/tools/service.py` (`read_messages`: check readability, read stored messages, and when fewer than the limit remain or the cursor passes the oldest stored message on Slack, make one live call with `latest` set to the oldest stored `ts`; return live messages without storing them; encode every message ID and thread ID with the codec from task 1.4; add the notes), `api/oss/src/core/channels/tools/destinations.py` (message and thread references), `api/oss/src/core/channels/tools/dtos.py`, `api/oss/src/utils/env.py` (`env.channels.tools.read_default_limit` 50 and `read_max_limit` 200).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_read_messages.py`.

1. Write `test_default_limit_is_50_and_max_is_200`, `test_stored_messages_come_first_oldest_first`, `test_slack_pages_past_stored_messages_with_one_live_call`, `test_live_messages_are_not_stored`, `test_rate_limit_returns_stored_messages_and_retry_note`, `test_result_notes_stored_messages_may_miss_edits`, `test_telegram_returns_stored_only_with_history_note`, `test_unreadable_channel_is_refused_without_calling_slack`, `test_direct_message_space_is_refused`, and `test_no_raw_slack_ids_in_output`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_read_messages.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): read channel messages, stored first then live Slack`.

### Task 4.5: Read route and SDK catalog entry

- Modify: `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/messages/read`), `api/oss/src/apis/fastapi/channels/models.py`, `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `read_channel_messages`, `read_only=True`, add it to `CHANNEL_TOOL_OPS`).
- Test: extend `api/oss/tests/pytest/unit/channels/test_channels_tools_router.py` and `sdks/python/oss/tests/pytest/unit/agents/platform/test_channel_ops.py`.

1. Write `test_read_rejects_unknown_fields` (router) and `test_read_channel_messages_is_read_only_and_hides_artifact_binding` (SDK).
2. Run both files with the commands from task 1.7. The new cases fail.
3. Implement.
4. Run both files. They pass.
5. Commit: `feat(api,sdk): expose read_channel_messages as a platform tool`.

---

## Phase 5: Search

PR title: `feat(api): search_channel_messages over stored messages`. Size: S-M, 2 tasks, about 1-2 days.

### Task 5.1: Full-text expression index

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000039_add_channel_inbox_search_index.py` (GIN index on `to_tsvector('simple', coalesce(data #>> '{processed,content,0,text}', ''))`, created with `CREATE INDEX CONCURRENTLY` outside the migration transaction).
- Modify: `api/oss/src/dbs/postgres/channels/dao.py` (one helper that builds the indexed expression, and `search_inbox_messages(project_id, space_ids, query, after, before, limit, cursor)` using `websearch_to_tsquery('simple', ...)`, skipping `action` events and consumed rows, ordered by rank, `coalesce(sent_at, created_at)`, and `id`), `api/oss/src/core/channels/interfaces.py`.
- Test: create `api/oss/tests/pytest/integration/channels/test_channels_dao_message_search.py`.

1. Write `test_search_matches_words`, `test_search_filters_by_space_and_time`, `test_cursor_is_stable_for_equal_rank_and_time`, `test_search_is_project_scoped`, and `test_query_uses_the_expression_index` (an `EXPLAIN` of the search names the new index).
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_message_search.py`. It fails.
3. Implement and apply the migration.
4. Run the same command. It passes.
5. Commit: `feat(api): full-text index over stored channel messages`.

### Task 5.2: `search_channel_messages`

- Modify: `api/oss/src/core/channels/tools/service.py` (`search_messages`: compute readable channel spaces at call time, excluding direct messages, intersect them with the requested destinations, and add the statement for each channel), `api/oss/src/core/channels/tools/dtos.py`, `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/messages/search`), `models.py`, `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `search_channel_messages`, `read_only=True`, limit at most 50, add it to `CHANNEL_TOOL_OPS`).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_search_messages.py`. Extend `test_channels_tools_router.py` and `test_channel_ops.py`.

1. Write `test_search_without_destinations_covers_all_readable_channels`, `test_narrowed_channel_is_excluded_immediately`, `test_foreign_destination_returns_no_matches`, `test_direct_messages_are_never_searched`, `test_result_says_searched_messages_since_the_bot_joined`, `test_search_never_calls_the_provider`, and `test_unknown_sender_name_is_omitted_not_raw`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_search_messages.py`. It fails.
3. Implement.
4. Run the same command, the router test, and the SDK `test_channel_ops.py`. All pass.
5. Commit: `feat(api,sdk): search_channel_messages over stored messages`.

---

## Verification: live QA

Run after phase 5 on a local EE stack (`load-env hosting/docker-compose/ee/.env.ee.dev` and `bash ./hosting/docker-compose/run.sh --ee --dev --build`), with the Agenta tools kit enabled. Use a fresh Slack workspace with a custom app built from the generated manifest, the hosted Slack app, a fresh Telegram bot, and the hosted Telegram bot. Do not add any channel tool to the agent's configuration. Record an MP4 of each flow and keep sanitized request and response evidence under `~/`, not `/tmp`.

**Slack**

1. Connect the bot and open the agent in the playground without editing its tools. The model is offered the four channel tools, and the saved configuration has no new revision. Disconnect the bot, run again, and the tools are gone. Reconnect it.
2. Invite the bot to one public and one private channel. Ask the agent in Agenta chat: "Where can you post?" The list shows both channels and no channel the bot is not in.
3. "Post 'QA hello' in #qa-public." No approval card appears. The message is in Slack, and the result says `sent` with a thread ID.
4. In the agent's tools, set `send_channel_message` to `ask`, as the tools kit allows, and post again. The approval card appears, and nothing is posted until it is approved. Put the setting back.
5. Set the agent-wide permission mode to `ask` and post. The approval card appears. Set it back.
6. Run an automation (a schedule) that asks the agent to post to #qa-public. It posts with no prompt.
7. "Reply in the thread from step 3 with 'follow-up'." It lands in the thread.
8. Post a few messages in #qa-private as a person. "Read the last 100 messages in #qa-private." The stored messages come first, including the bot's own posts, then older messages fetched live from Slack. On the custom app, page back several times. On the hosted app, page back twice within a minute: the second call returns the stored messages and the "about one history request per minute" note.
9. Edit and delete a message the bot stored. Read again. The stored part still shows the original text, and the result carries the note that stored messages may miss edits and deletions.
10. "Search for 'QA hello'." It finds the message, and the result says "Searched messages since the bot joined this channel." Search for a word used only before the bot joined. Nothing is found.
11. In Advanced, turn off "Can post outside the conversation". A send is refused, and a mention in a thread is still answered.
12. Narrow reading to #qa-public. A read or search of #qa-private is refused at once.
13. If direct messages are in v1: "DM <a member who never talked to the bot> 'ping'." The DM arrives. The person replies. The agent answers in a new private session that knows it sent "ping" and does not know the Agenta chat's content.

**Telegram**

1. Add the bot to a group and send a message there.
2. "Where can you post?" The list shows the group, with the note that Telegram allows no more.
3. "Post 'QA hello' in the group." It arrives.
4. "Read the group." Only messages the bot received appear, and the result says Telegram does not let bots read history. With privacy mode on, only messages addressed to the bot appear, and the note says why.
5. Remove the bot from the group and send again. The result is `failed` with a readable reason.
6. Repeat steps 2 and 3 on the hosted Telegram bot. Only chats bound to this project are listed.
7. If direct messages are in v1: have one user DM the bot and another never do so. Only the first is listed, and a DM to them arrives.

**Isolation and truthfulness**

- Copy a destination ID from project A into a run in project B. The result is not found.
- Block outbound traffic to `slack.com` during a send so the request times out. The result is `unknown`, and the runner's retry does not post twice.

## Risks

- **Posting without a human in the loop** follows from the `allow` default and the kit making the tools available in every run of a connected agent. A prompt injection in any channel the bot reads can make the agent post elsewhere. Mitigations are the posting setting, a per-tool or agent-wide `ask`, the operator kill switch, and the outbox record.
- **Slack's history limit for the hosted app** makes reading older history slow: about one live page of 15 messages per minute. It is accepted, and the read result says so. Customer-built apps are not affected.
- **Search sees only stored messages.** Anything from before the bot joined is not searchable until the history copy in Future work ships. Every result says what it searched.
- **Stored text can be stale.** Slack edits and deletions do not reach stored rows, so search can still find a deleted message. The read result notes it.
- **The Agenta tools kit and retention specifications are not published yet.** The assumptions in `design.md` must be checked when they land. Phase 1 must not ship activation before the kit exists.
- **Pull request #7128** changes how turns pick their messages and adds `is_consumed`. Task 4.2 depends on it for skipping consumed rows. Rebase on it before starting phase 4.
- **Private-to-public leaks** follow from the permissive default. The only mitigation in v1 is the read list.
- **Runs without a session** fail the send closed, because the idempotency key needs `$ctx.session.id`. Confirm that automation runs always carry a session.
- **The old UI test** that forbids an Advanced section (task 3.3) encodes an earlier decision to hide read-only defaults. The new section must keep that rule.
- **Migration numbers** can collide with other pull requests. Renumber at implementation time. The search index uses `CREATE INDEX CONCURRENTLY`, so its migration must run outside a transaction.
