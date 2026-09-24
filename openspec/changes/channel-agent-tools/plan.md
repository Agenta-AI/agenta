# Channel agent tools: implementation plan

**Goal:** Let an agent connected to Slack or Telegram list where it can post, post to a channel or a person, read a channel's recent history, and search its channels, under three per-bot settings.

**Architecture:** Four endpoint-mode platform tools call new authenticated routes under `/api/channels/tools/`. The SDK agent handler adds them to every run of an agent bound to an active bot, and the send tool defaults to `allow`. The runner binds the agent's identity, session, and tool call ID. A `ChannelToolsService` in `api/oss/src/core/channels/tools/` resolves the agent's bots, applies the bot settings on every call, and posts through the existing outbox and adapters. A local `channel_messages` history, fed by live events, sends, and a rate-aware Slack backfill worker, serves reading and search.

**Tech stack:** Python 3 with FastAPI, Pydantic, SQLAlchemy, Alembic, and Taskiq (API); PostgreSQL full-text search; httpx against the Slack Web API and the Telegram Bot API; TypeScript with Vitest (runner); React with Vitest and Storybook (`@agenta/settings-ui`).

Read [design.md](design.md) first. Each phase ships as its own pull request, in this order. Phases 1 and 2 give the agent a working send path. Phase 3 gives admins the switches. Phase 3 depends only on phase 1, so it can merge before phase 2. It must not ship in a later release than phase 2: the send tool is added to every connected agent and posts without a prompt, so admins need the posting switch from the first day it exists. Phases 4 and 5 then add the larger read and search surface.

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

PR title: `feat(api): channel destinations and the list_channel_destinations tool`. Size: M, 8 tasks, about 4-5 days.

### Task 1.1: Bot settings block

- Modify: `api/oss/src/core/channels/dtos.py` (add `ChannelAgentToolSettings` with `can_post_outside_conversation: bool = True`, `can_message_people: bool = True`, `readable_space_ids: Optional[List[UUID]] = None`; add `tools: ChannelAgentToolSettings` to `ChannelAgentData` and `tools: Optional[ChannelAgentToolSettings]` to `ChannelAgentDataEdit`), `api/oss/src/core/channels/service.py` (`_layer_agent_edit` layers `tools`).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_agent_tool_settings.py`.

1. Write `test_agent_data_without_tools_reads_defaults` (a `ChannelAgentData` built from `{"references": {...}}` has both switches on and `readable_space_ids is None`), `test_edit_tools_keeps_references_and_policy` (layering a `tools` edit leaves `references` and `policy` unchanged), and `test_edit_without_tools_keeps_stored_tools`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_agent_tool_settings.py`. It fails with an attribute error on `tools`.
3. Add the model and the layering.
4. Run the same command. It passes. Also run `oss/tests/pytest/unit/channels/test_channels_edit_semantics.py` and `test_channels_dtos.py`.
5. Commit: `feat(api): add channel tool settings to ChannelAgentData`.

### Task 1.2: People table

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000036_add_channel_people.py` (table `channel_people`: `project_id`, `id`, `connection_id`, `external_key` string, `space_id` nullable, `name`, `handle`, `flags` JSONB, lifecycle columns; unique `(project_id, connection_id, external_key)`; index on `(project_id, connection_id, lower(name))`).
- Modify: `api/oss/src/core/channels/dtos.py` (`ChannelPerson`, `ChannelPersonCreate`, `ChannelPersonQuery`), `api/oss/src/core/channels/interfaces.py` (`upsert_people`, `query_people`, `fetch_person`, `link_person_space`), `api/oss/src/dbs/postgres/channels/dbas.py`, `dbes.py`, `mappings.py`, `dao.py`.
- Test: create `api/oss/tests/pytest/integration/channels/test_channels_dao_people.py`, using the `channels_scope` fixture from `integration/channels/conftest.py`.

1. Write `test_upsert_people_is_idempotent_on_external_key` (the same key twice leaves one row and updates the name), `test_query_people_filters_by_name_prefix_case_insensitively`, `test_query_people_pages_with_cursor`, and `test_people_are_project_scoped` (a second project sees nothing).
2. Run `load-env hosting/docker-compose/oss/.env.oss.dev`, then `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_people.py`. It fails because the table is missing.
3. Add the migration, entity, mappings, and DAO methods. Apply the migration to the local stack with `bash ./hosting/docker-compose/run.sh --oss --dev --build`. Note that `--recreate api` alone does not migrate.
4. Run the same command. It passes.
5. Commit: `feat(api): add the channel_people table`.

### Task 1.3: Slack member channels and people

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

### Task 1.8: Add the channel tools to every run of a connected agent

- Create: `sdks/python/agenta/sdk/agents/platform/channel_tools.py` (`read_channel_tools_availability(workflow_id)` calls `POST /api/channels/tools/availability` with the platform connection's credential; `add_channel_tools(tools, available)` appends a `PlatformToolConfig(op=...)` for each op in `CHANNEL_TOOL_OPS` that the author did not already declare).
- Modify: `sdks/python/agenta/sdk/agents/handler.py` (new `AgentComposition.resolve_channel_tools` field next to `resolve_session_context` at line 332; in `_agent`, compute the artifact with `_agent_artifact_id(comp.run_context(), request.references)` and call the hook under one deadline, as `_bounded_session_context` does at line 136, before `comp.resolve_tools(...)` at line 386), `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/availability` returns `{"available": bool}` for the artifact), `api/oss/src/core/channels/tools/service.py` (`is_available` reuses `resolve_bots` from task 1.5).
- Test: create `sdks/python/oss/tests/pytest/unit/agents/test_channel_tools_injection.py`. Extend `api/oss/tests/pytest/unit/channels/test_channels_tools_router.py`.

1. Write `test_connected_agent_gets_every_channel_op`, `test_unconnected_agent_gets_none`, `test_author_declared_op_is_kept_as_authored_and_not_duplicated` (an explicit `send_channel_message` with `permission="ask"` stays single and keeps `ask`), `test_availability_timeout_adds_nothing_and_logs`, `test_saved_template_is_not_mutated`, and, in the router file, `test_availability_is_false_after_disconnect`.
2. Run `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/test_channel_tools_injection.py`. It fails on import.
3. Implement the hook, the helper, and the route.
4. Run the same command, the router test, and `oss/tests/pytest/unit/agents/test_agent_composition_seam.py` in the SDK. All pass.
5. Commit: `feat(sdk,api): add channel tools to runs of connected agents`.

---

## Phase 2: The send tool and the delivery record

PR title: `feat(api): send_channel_message with a durable delivery record`. Size: L, 8 tasks, about 4-5 days.

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

### Task 2.5: Send to a person with a private session

- Modify: `api/oss/src/core/channels/adapters/interface.py` and `adapters/slack/adapter.py` (`open_direct_conversation(connection, person_locator)` calls `conversations.open`), `api/oss/tests/pytest/unit/channels/slack/fake_slack.py` (answer `conversations.open`), `api/oss/src/core/channels/tools/service.py` (person path: find or create the private space and link it on the person row; find the agent's active thread there or create one with `session_id=str(uuid4())`; set `thread_id` on the outbox row), `api/oss/src/core/channels/service.py` (`compose_input` adds the thread's unseen tool-origin outbox rows as the agent's earlier message).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_send_direct_message.py` and `api/oss/tests/pytest/unit/channels/test_channels_compose_proactive_message.py`. Extend `slack/test_slack_directory.py`.

1. Write `test_open_direct_conversation_calls_conversations_open` (Slack file), `test_slack_person_send_opens_conversation_and_creates_private_thread`, `test_existing_active_private_thread_is_reused`, `test_source_session_is_not_linked_or_copied`, `test_telegram_person_without_private_chat_is_not_found`, `test_direct_messages_off_refuses_person_send`, and `test_next_private_turn_includes_the_sent_text_once`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_send_direct_message.py` and `oss/tests/pytest/unit/channels/test_channels_compose_proactive_message.py`. Both fail.
3. Implement.
4. Run both commands, plus `oss/tests/pytest/unit/channels/test_channels_service_routing.py` and `test_channels_fill.py`. All pass.
5. Commit: `feat(api): proactive direct messages use their own private session`.

### Task 2.6: Slack messages tab

- Modify: `api/oss/src/core/channels/adapters/slack/manifest.py` (add `features.app_home` with `messages_tab_enabled: true` and `messages_tab_read_only_enabled: false`).
- Test: modify `api/oss/tests/pytest/unit/channels/slack/test_slack_manifest.py`.

1. Write `test_manifest_lets_people_reply_in_the_messages_tab`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_manifest.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `fix(api): enable the Slack messages tab so people can answer the bot`.

### Task 2.7: Per-operation default permission

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

1. Write `it("shows both switches on and All channels by default")`, `it("disables Can message people directly while posting is off")`, `it("saves only the checked channels under Only these channels")`, `it("shows the error and the stored value after a failed save")`, and `it("explains the Telegram limits under each control")`.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelAdvancedSection.test.tsx`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(frontend): Advanced section with channel tool settings`.

### Task 3.3: Update the old guard test and add stories

- Modify: `web/packages/agenta-settings-ui/tests/unit/channelManagePanel.test.tsx`. The test `shows no read-only settings: no Advanced defaults and no Status row` forbids the word "Advanced". Keep its intent: no read-only defaults and no Status row. Change it to assert that the Advanced section holds only the three editable controls.
- Modify: `src/channels/ChannelManagePanel.stories.tsx` (Slack default, Slack narrowed, Telegram, posting off).

1. Edit the test so it fails against the old panel and describes the new rule.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelManagePanel.test.tsx`.
3. Add the stories.
4. Run the same command and `pnpm types:check`. Both pass. Then run `cd web && pnpm lint-fix`.
5. Commit: `test(frontend): the Advanced section holds only editable channel settings`.

---

## Phase 4: Message history, Slack backfill, and the read tool

PR title: `feat(api): channel message history and read_channel_messages`. Size: L, 8 tasks, about 4-6 days.

### Task 4.1: History table

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000038_add_channel_messages.py` (table `channel_messages`: `project_id`, `id`, `connection_id`, `space_id`, `external_key` (provider message key), `thread_external_key`, `parent_id`, `sender_person_id`, `sender_name`, `is_bot`, `text`, `sent_at`, `state`, `origin`, `reply_count`, lifecycle columns; unique `(project_id, space_id, external_key)`; index `(project_id, space_id, sent_at DESC, id DESC)`).
- Modify: `api/oss/src/core/channels/dtos.py` (`ChannelMessage`, `ChannelMessageUpsert`, `ChannelMessageState`, `ChannelSpaceHistory` added to `ChannelSpaceData` as `history`), `interfaces.py`, `dbs/postgres/channels/dbas.py`, `dbes.py`, `mappings.py`, `dao.py`.
- Test: create `api/oss/tests/pytest/integration/channels/test_channels_dao_messages.py`.

1. Write `test_upsert_message_is_idempotent_on_provider_key`, `test_edit_keeps_id_and_replaces_text`, `test_delete_hides_message_from_reads`, `test_read_pages_newest_first_with_stable_cursor`, and `test_thread_read_returns_root_and_replies`.
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_messages.py`. It fails.
3. Implement and apply the migration.
4. Run the same command. It passes.
5. Commit: `feat(api): add the channel_messages history table`.

### Task 4.2: History configuration

- Modify: `api/oss/src/utils/env.py` (`ChannelsHistoryConfig` under `ChannelsConfig`: `backfill_days` 90, `backfill_messages` 1000, `backfill_threads` 200, `read_default_limit` 50, `read_max_limit` 200, read from `AGENTA_CHANNELS_HISTORY_*`).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_history_env.py`.

1. Write `test_history_defaults` and `test_history_values_come_from_env`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_history_env.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): channel history settings in env`.

### Task 4.3: Slack edits and deletions

- Modify: `api/oss/src/core/channels/adapters/interface.py` (`parse_message_update(body) -> Optional[ChannelMessageUpdate]`, default `None`), `adapters/slack/adapter.py` (map `message_changed` and `message_deleted`; ignore the bot's own edits), `api/oss/src/apis/fastapi/channels/ingress.py` (after the signature check, pass an update to `ChannelsService.apply_message_update` and do not enqueue a turn).
- Test: create `api/oss/tests/pytest/unit/channels/slack/test_slack_message_updates.py`. Extend `api/oss/tests/pytest/unit/channels/test_channels_ingress.py`.

1. Write `test_message_changed_becomes_an_edit`, `test_message_deleted_becomes_a_deletion`, `test_parse_event_still_drops_both_subtypes`, `test_bot_indicator_edit_is_ignored`, and, in the ingress file, `test_message_update_is_applied_without_enqueueing_a_turn`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_message_updates.py`. It fails.
3. Implement.
4. Run the same command, plus `oss/tests/pytest/unit/channels/test_channels_ingress.py` and `oss/tests/pytest/unit/channels/slack/test_slack_adapter.py`. All pass.
5. Commit: `feat(api): apply Slack message edits and deletions to history`.

### Task 4.4: Write history from events and sends

- Create: `api/oss/src/core/channels/history.py` (`ChannelHistoryService.record_inbound`, `record_sent`, `apply_update`, and `is_readable(agent, space)`).
- Modify: `api/oss/src/tasks/asyncio/channels/inbox.py` (in `dispatch_event`, after `resolve` attaches the space, record the message when readable, including when no turn starts), `api/oss/src/core/channels/service.py` (`deliver` records a `sent` message on success).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_history_projection.py`.

1. Write `test_non_trigger_message_in_readable_channel_is_recorded`, `test_message_in_unreadable_channel_is_not_recorded`, `test_direct_message_is_never_recorded`, and `test_sent_message_is_recorded_as_bot`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_history_projection.py`. It fails.
3. Implement.
4. Run the same command, plus `oss/tests/pytest/unit/channels/test_channels_inbox_dispatcher.py` and `test_channels_outbox_worker.py`. All pass.
5. Commit: `feat(api): record channel messages into history`.

### Task 4.5: Paged Slack history

- Modify: `api/oss/src/core/channels/adapters/interface.py` (`fetch_history_page(connection, locator, cursor, oldest, limit)` returns messages, including bot messages, and a next cursor), `adapters/slack/adapter.py` (read `Retry-After` on HTTP 429 and raise `ChannelRateLimited(retry_after_seconds)`), `api/oss/src/core/channels/types.py` (`ChannelRateLimited`), `api/oss/tests/pytest/unit/channels/slack/fake_slack.py` (cursors, `oldest`, and a scripted 429).
- Test: create `api/oss/tests/pytest/unit/channels/slack/test_slack_history_pages.py`.

1. Write `test_history_page_returns_next_cursor`, `test_history_page_honours_oldest`, `test_replies_page_includes_root_and_replies`, `test_429_raises_rate_limited_with_retry_after`, and `test_missing_scope_raises_backfill_refused`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_history_pages.py`. It fails.
3. Implement.
4. Run the same command, plus `oss/tests/pytest/unit/channels/slack/test_slack_over_fake.py`. Both pass.
5. Commit: `feat(api): paged Slack history with rate-limit handling`.

### Task 4.6: Backfill worker

- Create: `api/oss/src/tasks/taskiq/channels/history_worker.py` (`ChannelsHistoryWorker` with a `backfill_space` task), and `ChannelHistoryService.backfill_space` in `api/oss/src/core/channels/history.py` (walk pages within the bounds, then threads; store progress and coverage in `ChannelSpaceData.history`; sleep on `ChannelRateLimited`).
- Modify: `api/entrypoints/worker_queues.py` (add the `channels-history` consumer on `queues:channels-history` and update the module docstring's list).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_history_backfill.py`. Extend `api/oss/tests/pytest/unit/channels/test_channels_worker_gate.py` if it lists the consumers.

1. Write `test_backfill_stops_at_message_bound`, `test_backfill_stops_at_day_bound`, `test_backfill_fetches_threads_up_to_bound`, `test_backfill_waits_retry_after_and_resumes`, `test_backfill_resumes_from_saved_cursor_after_restart`, `test_backfill_marks_refused_on_missing_scope`, and `test_coverage_moves_pending_running_complete`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_history_backfill.py`. It fails.
3. Implement.
4. Run the same command, plus `oss/tests/pytest/unit/channels/test_channels_worker_gate.py`. Both pass.
5. Commit: `feat(api): bounded Slack history backfill worker`.

### Task 4.7: Queue backfills and cleanups

- Modify: `api/oss/src/core/channels/tools/service.py` (queue a backfill when the directory sync finds a new member channel), `api/oss/src/core/channels/service.py` (`edit_agent` queues backfills for channels added to `readable_space_ids` and a cleanup for channels removed from it; `archive_connection` queues a cleanup), `api/oss/src/core/channels/history.py` (`purge_space`).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_history_triggers.py`.

1. Write `test_new_member_channel_queues_backfill`, `test_readding_channel_queues_backfill`, `test_narrowing_queues_cleanup`, and `test_archiving_connection_queues_cleanup`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_history_triggers.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): start and clean up channel history when readability changes`.

### Task 4.8: `read_channel_messages`

- Modify: `api/oss/src/core/channels/tools/service.py` (`read_messages`, with a one-page inline `conversations.replies` fetch for an unfetched thread), `tools/dtos.py`, `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/messages/read`), `models.py`, `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `read_channel_messages`, `read_only=True`; add it to `CHANNEL_TOOL_OPS`).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_read_messages.py`. Extend `test_channels_tools_router.py` and `test_channel_ops.py`.

1. Write `test_default_limit_is_50_and_max_is_200`, `test_messages_are_oldest_first_with_older_cursor`, `test_thread_read_fetches_unfetched_thread_once`, `test_unreadable_channel_is_refused`, `test_person_destination_is_refused`, `test_deleted_messages_are_not_returned`, `test_bot_messages_are_marked`, `test_telegram_coverage_is_observed_only_with_privacy_note`, and `test_partial_backfill_reports_partial`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_read_messages.py`. It fails.
3. Implement.
4. Run the same command, the router test, and the SDK `test_channel_ops.py`. All pass.
5. Commit: `feat(api,sdk): read_channel_messages over channel history`.

---

## Phase 5: Search

PR title: `feat(api): search_channel_messages`. Size: M, 2 tasks, about 2-3 days.

### Task 5.1: Full-text index

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000039_add_channel_message_search.py` (generated column `search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(text, ''))) STORED` and a GIN index).
- Modify: `api/oss/src/dbs/postgres/channels/dao.py` (`search_messages(project_id, space_ids, query, sender_person_id, after, before, limit, cursor)` using `websearch_to_tsquery('simple', ...)`, ordered by rank, `sent_at`, and `id`).
- Test: create `api/oss/tests/pytest/integration/channels/test_channels_dao_message_search.py`.

1. Write `test_search_matches_words`, `test_search_filters_by_space_sender_and_time`, `test_cursor_is_stable_for_equal_rank_and_time`, `test_deleted_messages_do_not_match`, and `test_search_is_project_scoped`.
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_message_search.py`. It fails.
3. Implement and apply the migration.
4. Run the same command. It passes.
5. Commit: `feat(api): full-text index over channel history`.

### Task 5.2: `search_channel_messages`

- Modify: `api/oss/src/core/channels/tools/service.py` (`search_messages`: compute readable spaces at call time, intersect with the requested destinations, attach coverage for each channel), `tools/dtos.py`, `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/messages/search`), `models.py`, `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `search_channel_messages`, `read_only=True`, limit at most 50; add it to `CHANNEL_TOOL_OPS`).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_search_messages.py`. Extend `test_channels_tools_router.py` and `test_channel_ops.py`.

1. Write `test_search_without_destinations_covers_all_readable_channels`, `test_narrowed_channel_is_excluded_immediately`, `test_foreign_destination_returns_no_matches`, `test_direct_messages_are_never_searched`, `test_response_has_coverage_for_each_channel`, and `test_unknown_sender_name_is_omitted_not_raw`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_search_messages.py`. It fails.
3. Implement.
4. Run the same command, the router test, and the SDK `test_channel_ops.py`. All pass.
5. Commit: `feat(api,sdk): search_channel_messages over channel history`.

---

## Verification: live QA

Run after phase 5 on a local EE stack (`load-env hosting/docker-compose/ee/.env.ee.dev` and `bash ./hosting/docker-compose/run.sh --ee --dev --build`). Use a fresh Slack workspace with a custom app built from the generated manifest, the hosted Slack app if available, a fresh Telegram bot, and the hosted Telegram bot. Do not add any channel tool to the agent's configuration: the tools must appear on their own once the bot is connected. Record an MP4 of each flow and keep sanitized request and response evidence under `~/`, not `/tmp`.

**Slack**

1. Connect the bot, then open the agent in the playground without editing its tools. The model is offered the four channel tools, and the saved configuration has no new revision. Disconnect the bot, run again, and the tools are gone. Reconnect it.
2. Invite the bot to one public and one private channel. Ask the agent in Agenta chat: "Where can you post?" The list shows both channels and workspace people, and no channel the bot is not in.
3. "Post 'QA hello' in #qa-public." No approval card appears. The message is in Slack, and the result says `sent` with a thread ID.
4. In the agent's tools, add `send_channel_message` with permission `ask` and post again. The approval card appears and nothing is posted until it is approved. The run shows one send tool, not two. Remove the entry again.
5. Set the agent-wide permission mode to `ask` and post. The approval card appears. Set it back.
6. Run an automation (a schedule) that asks the agent to post to #qa-public. It posts with no prompt.
7. "Reply in the thread from step 3 with 'follow-up'." It lands in the thread.
8. "DM <a member who never talked to the bot> 'ping'." The DM arrives. The person replies in the DM thread. The agent answers in a new private session that knows it sent "ping" and does not know the Agenta chat's content.
9. Mention the agent in #qa-public and ask it to DM someone. The DM contains only the sent text.
10. "Read the last 100 messages in #qa-private." The result matches Slack, includes the bot's own posts, and reports coverage. Edit and delete a message, then read again. The changes show.
11. "Search for 'QA hello'." It finds the message.
12. In Advanced, turn off "Can post outside the conversation". A send is refused, and a mention in a thread is still answered. Turn it on and turn off direct messages. The list has no people, and a DM is refused.
13. Narrow reading to #qa-public. A read or search of #qa-private is refused at once.
14. Invite the bot to a channel with more than 1,000 messages. Watch the worker logs for bounded pages, a `Retry-After` wait if Slack sends one, and coverage moving to `complete` or `partial`.
15. Kill the worker mid-backfill and restart it. The backfill resumes with no duplicate rows.

**Telegram**

1. Add the bot to a group and send a message there. Have one user DM the bot and another user never do so.
2. "Where can you post?" The list shows the group and only the user who wrote first, with the note that Telegram allows no more.
3. "Post 'QA hello' in the group" and "DM <the user who wrote first> 'ping'." Both arrive. The DM reply continues a private session.
4. "Read the group." Only messages sent after the bot joined appear, and coverage says `observed_only`. With privacy mode on, only messages addressed to the bot appear, and the note says why.
5. Remove the bot from the group and send again. The result is `failed` with a readable reason.
6. Repeat 2 and 3 on the hosted Telegram bot. Only chats bound to this project are listed.

**Isolation and truthfulness**

- Copy a destination ID from project A into a run in project B. The result is not found.
- Block outbound traffic to `slack.com` during a send so the request times out. The result is `unknown`, and the runner's retry does not post twice.

## Risks

- **Slack's history limits for non-Marketplace apps** can slow backfill to about one page of 15 messages a minute for the hosted app. Check the app's status before release and tune the bounds. Customer-built apps are not affected.
- **Posting without a human in the loop** follows from the `allow` default and the automatic addition. A prompt injection in any channel the bot reads can make the agent post elsewhere or message anyone. Mitigations are the Advanced settings, a per-tool or agent-wide `ask`, the operator kill switch, and the delivery record.
- **Every agent run pays one availability call** to add the channel tools. It is bounded by a deadline and fails toward no tools.
- **Private-to-public leaks** follow from the permissive default. The only mitigation in v1 is the read list. Say so in the release notes.
- **Runs without a session** fail the send closed, because the idempotency key needs `$ctx.session.id`. Confirm that automation runs always carry a session.
- **The old UI test** that forbids an Advanced section (task 3.3) encodes an earlier decision to hide read-only defaults. The new section must keep that rule.
- **Directory sync in very large workspaces** can take several `users.list` pages. The cache time-to-live and the name filter keep it off the hot path, but the first call after expiry is slow.
- **Migration numbers** can collide with other pull requests. Renumber at implementation time.
- **Proactive messages in Slack channels** start threads that have no Agenta session. A later mention in such a thread starts a fresh session through normal routing. That is intended, but QA should confirm it reads naturally.
