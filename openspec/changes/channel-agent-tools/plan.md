# Channel agent tools: implementation plan

Status: approved on 2026-09-24 and implemented on branch `feat/channel-agent-tools`.

**Goal:** Let an agent connected to Slack or Telegram list the channels where it can post, post there, read a channel's history, and search its channels' stored messages, under per-bot settings.

**Architecture:** Four endpoint-mode platform tools call new authenticated routes under `/api/channels/tools/`. The send tool defaults to `allow`. A `ChannelToolsService` in `api/oss/src/core/channels/tools/` resolves the agent's bots, applies the bot settings on every call, posts through the existing outbox and adapters, reads stored inbox and outbox rows with live Slack history for older messages, and searches stored inbox rows through a full-text expression index. No new message table. The Agenta tools kit, a separate specification, will add the tools to a connected agent's runs automatically. This change gives it its condition (`POST /api/channels/tools/availability`) and its channel group (`CHANNEL_TOOL_OPS`). Until the kit ships, an author adds the tools to the agent's tools as `{"type": "platform", "op": "<name>"}`.

**Tech stack:** Python 3 with FastAPI, Pydantic, SQLAlchemy, and Alembic (API); PostgreSQL full-text search; httpx against the Slack Web API and the Telegram Bot API; TypeScript with Vitest (runner); React with Vitest and Storybook (`@agenta/settings-ui`).

Read [design.md](design.md) first. All phases ship in one pull request. The phases below give the order the work was done in.

| Phase | Scope | Tasks |
| --- | --- | ---: |
| 1 | Destinations, bot settings, list tool, kit condition | 7 |
| 2 | Send tool, delivery record, tool call ID, `allow` default | 5 |
| 3 | Settings UI: the Advanced section | 3 |
| 4 | Read tool: stored messages, then live Slack history | 5 |
| 5 | Search tool over stored messages | 2 |
| | Live QA and fixes | |

Task numbers are kept from the approved plan. Tasks 1.2, 2.5, and 2.6 were for direct messages to people, which are a follow-up and not part of v1. Task 2.3 was dropped during implementation (see below).

## Conventions used in every task

Commands run from the repository root unless a `cd` is shown.

- **API unit test:** `cd api && uv run --no-sync python run-tests.py <path>[::<test>]`. Run `uv sync --locked` once first.
- **API integration test** (needs the local Postgres; see `hosting/AGENTS.md`): `load-env hosting/docker-compose/oss/.env.oss.dev`, then `cd api && uv run --no-sync python run-tests.py <path>[::<test>]`.
- **SDK unit test:** `cd sdks/python && uv run --no-sync python run-tests.py <path>[::<test>]`.
- **Runner unit test:** `cd services/runner && pnpm vitest run --project unit <path>`.
- **Settings UI unit test:** `cd web/packages/agenta-settings-ui && pnpm vitest run <path>`.
- **Before each commit:** `cd api && ruff format && ruff check --fix` for API changes. Do the same in `sdks/python` for SDK changes. Run `cd web && pnpm lint-fix` for web and runner changes. In a GitButler workspace, commit with `but commit <branch> -m "<message>"`. Otherwise use `git commit -m "<message>"`.
- API unit tests for the tool service live in `api/oss/tests/pytest/unit/channels/tools/`. They reuse the in-memory DAO pattern from `api/oss/tests/pytest/unit/channels/test_channels_outbox_worker.py` and the fake adapter in `api/oss/tests/pytest/unit/channels/contract/fakes.py`.
- Migrations are `oss000000036` to `oss000000038`, after `oss000000035` in `api/oss/databases/postgres/migrations/core_oss/versions/`.

Every task follows five steps: (1) write the failing test, (2) run it and see it fail, (3) implement, (4) run it and see it pass, (5) commit. When the run command is the same for steps 2 and 4, it is written once.

---

## Phase 1: Destinations, bot settings, and the list tool

### Task 1.1: Bot settings block

- Modify: `api/oss/src/core/channels/dtos.py` (add `ChannelAgentToolSettings` with `can_post_outside_conversation: bool = True` and `readable_space_keys: Optional[List[UUID]] = None`; add `tools: ChannelAgentToolSettings` to `ChannelAgentData` and `tools: Optional[ChannelAgentToolSettings]` to `ChannelAgentDataEdit`), `api/oss/src/core/channels/service.py` (`_layer_agent_edit` layers `tools`).
- Built as: the readable list stores space keys, not space row IDs, because the settings page picks from discovered Slack channels that may have no space row yet. The discovery candidates of `POST /channels/spaces/discover` now carry `external_key` so the page can store them.
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_agent_tool_settings.py`.

1. Write `test_agent_data_without_tools_reads_defaults` (a `ChannelAgentData` built from `{"references": {...}}` has posting on and `readable_space_keys is None`), `test_edit_tools_keeps_references_and_policy` (layering a `tools` edit leaves `references` and `policy` unchanged), and `test_edit_without_tools_keeps_stored_tools`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_agent_tool_settings.py`. It fails with an attribute error on `tools`.
3. Add the model and the layering.
4. Run the same command. It passes. Also run `oss/tests/pytest/unit/channels/test_channels_edit_semantics.py` and `test_channels_dtos.py`.
5. Commit: `feat(api): add channel tool settings to ChannelAgentData`.

### Task 1.3: Slack member channels

- Modify: `api/oss/src/core/channels/adapters/interface.py` (add `list_member_spaces(connection, cursor)`, returning a page and a next cursor; the default raises `ChannelNotSupported`), `api/oss/src/core/channels/adapters/slack/adapter.py` (page `users.conversations` with `types=public_channel,private_channel`, skipping `im` and `mpim`), and `adapters/mock/adapter.py`.
- Built as: no `ChannelDirectory` capability. `ChannelNotSupported` from `list_member_spaces` is the capability signal, so Telegram falls back to stored group spaces without a second flag saying the same thing.
- Modify: `api/oss/tests/pytest/unit/channels/slack/fake_slack.py` (answer `users.conversations` with paging).
- Test: create `api/oss/tests/pytest/unit/channels/slack/test_slack_member_spaces.py`.

1. Write `test_list_member_spaces_follows_cursor_and_skips_non_members`, `test_list_member_spaces_skips_group_dms`, and `test_telegram_has_no_member_listing`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_member_spaces.py`. It fails because the method is missing.
3. Implement the adapter method and extend the fake.
4. Run the same command and `oss/tests/pytest/unit/channels/slack/test_slack_contract_suite.py`. Both pass.
5. Commit: `feat(api): list the Slack channels a bot is a member of`.

### Task 1.4: Opaque destination IDs

- Create: `api/oss/src/core/channels/tools/__init__.py`, `api/oss/src/core/channels/tools/ids.py` (`encode_destination_id(space_id)` and `decode_destination_id(value)`, which returns `None` for anything malformed; `encode_space_ref` and `decode_space_ref` for thread IDs, message IDs, and read cursors, which pack the space ID with the provider reference in base64).
- Test: create `api/oss/tests/pytest/unit/channels/tools/__init__.py` and `test_destination_ids.py`.

1. Write `test_destination_id_round_trips`, `test_malformed_destination_id_decodes_to_none` (empty, wrong prefix, bad UUID, a raw Slack ID such as `C0123`), `test_destination_id_contains_no_provider_identifier`, `test_thread_and_message_refs_round_trip_inside_their_space`, `test_malformed_space_ref_decodes_to_none`, and `test_a_message_ref_is_not_a_thread_ref`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_destination_ids.py`. It fails on import.
3. Implement the codec.
4. Run the same command. It passes.
5. Commit: `feat(api): opaque channel destination ids`.

### Task 1.5: Match the run to its bots

- Create: `api/oss/src/core/channels/tools/service.py` (`ChannelToolsService.resolve_bots(project_id, artifact_id)` returns the matching `(ChannelAgent, ChannelConnection)` pairs), `api/oss/src/core/channels/tools/types.py` (`ChannelToolsNoBot`, `ChannelToolsAmbiguousBot`, `ChannelToolsRefused`, `ChannelToolsNotFound`).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_resolve_bots.py`.

1. Write `test_matches_application_reference`, `test_matches_workflow_reference`, `test_matches_variant_and_revision_references_through_their_artifact` (with a stubbed workflows lookup), `test_skips_inactive_and_unverified_connections`, `test_skips_archived_connections_and_inactive_bindings`, `test_two_bots_on_one_connection_are_refused_as_ambiguous`, `test_bots_on_two_connections_both_match`, and `test_no_match_returns_empty`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_resolve_bots.py`. It fails on import.
3. Implement the matcher. Look up variant and revision artifacts through the workflows service that `api/entrypoints/routers.py` already builds.
4. Run the same command. It passes.
5. Commit: `feat(api): resolve a run's channel bots from its workflow artifact`.

### Task 1.6: `list_destinations`

- Modify: `api/oss/src/core/channels/tools/service.py` (`list_destinations` and the member-channel cache), create `api/oss/src/core/channels/tools/dtos.py` (`ChannelDestination`, `ChannelDestinationsPage`), `api/oss/src/core/channels/adapters/telegram/adapter.py` (record the chat `title` in the event locator, so a group has a name).
- Built as: the member list is cached in the API process for 120 seconds per connection (`_MEMBER_CACHE`), not as a `directory_synced_at` time stored on the connection, and with no environment variable. The cache only spares Slack a listing call, so a per-process cache that a restart clears is enough. Paging uses an offset over a total order.
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_list_destinations.py`. Extend `api/oss/tests/pytest/unit/channels/telegram/test_telegram_adapter.py`.

1. Write `test_slack_lists_member_channels_only`, `test_listing_reuses_the_space_the_ingress_created`, `test_posting_off_marks_channels_not_postable`, `test_readable_list_sets_can_read_per_channel`, `test_name_filter_and_paging`, `test_second_call_within_ttl_does_not_call_slack`, `test_no_connected_bot_lists_nothing`, `test_telegram_lists_stored_groups_but_never_private_chats`, `test_telegram_result_carries_the_limits_note`, and `test_hosted_telegram_lists_only_chats_bound_to_this_project`. In the Telegram file, write `test_parse_event_keeps_a_group_title_for_the_destination_list`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_list_destinations.py`. It fails.
3. Implement the listing, the cache, and the Telegram title.
4. Run the same command, the Telegram file, and `oss/tests/pytest/unit/channels/test_channels_service_routing.py`. All pass.
5. Commit: `feat(api): list a connected agent's channel destinations`.

### Task 1.7: Tool router and SDK catalog entry

- Create: `api/oss/src/apis/fastapi/channels/tools.py` (`ChannelToolsRouter` with `POST /tools/destinations/query`; every handler checks `Permission.RUN_CHANNELS`; request models use `extra="forbid"`; a refusal maps to HTTP 409 with a message for the model, and an unknown or foreign reference to HTTP 404).
- Modify: `api/oss/src/apis/fastapi/channels/models.py`, `api/entrypoints/routers.py` (build `ChannelToolsService` and mount the router under `/channels` next to `ChannelsRouter`), `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `list_channel_destinations`: `POST /api/channels/tools/destinations/query`, `read_only=True`, `context_bindings={"artifact_id": "$ctx.workflow.artifact.id"}`, closed input schema; add a `CHANNEL_TOOL_OPS` tuple that later phases extend).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_tools_router.py` (the mocked-request pattern of `test_channels_router.py`) and `sdks/python/oss/tests/pytest/unit/agents/platform/test_channel_ops.py`.

1. Write `test_tools_routes_require_run_channels`, `test_tools_routes_reject_unknown_fields`, `test_destinations_query_passes_the_project_from_the_credential`, `test_destinations_response_has_no_raw_provider_ids`, and `test_refusals_map_to_readable_errors`, and, in the SDK file, `test_list_channel_destinations_is_read_only_and_hides_artifact_binding` and `test_channel_tool_ops_are_the_kit_group`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_tools_router.py` and `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/platform/test_channel_ops.py`. Both fail.
3. Implement the router, the wiring, and the catalog entry.
4. Run both commands, plus `oss/tests/pytest/unit/agents/platform/test_op_catalog.py` in the SDK. All pass.
5. Commit: `feat(api,sdk): expose list_channel_destinations as a platform tool`.

### Task 1.8: The condition the Agenta tools kit reads

The Agenta tools kit specification (`docs/agenta-tools-kit`) owns how the channel tools are added to a run and turned off. It is not yet approved or built. This task gives the kit its condition: is this agent connected to an active, verified bot?

- Modify: `api/oss/src/core/channels/tools/service.py` (`is_available(project_id, artifact_id)` reuses `resolve_bots` from task 1.5), `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/availability` returns `{"available": bool}`), `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (`CHANNEL_TOOL_OPS` is the list the kit reads for its channel group).
- Test: extend `api/oss/tests/pytest/unit/channels/tools/test_resolve_bots.py` and `api/oss/tests/pytest/unit/channels/test_channels_tools_router.py`.

1. Write `test_is_available_true_for_active_verified_bot`, `test_is_available_false_after_disconnect_or_archive`, and, in the router file, `test_availability_answers_the_kit`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_resolve_bots.py`. The new cases fail.
3. Implement.
4. Run the same command and the router test. Both pass.
5. Commit: `feat(api): tell the tools kit when an agent is connected to a bot`.

---

## Phase 2: The send tool and the delivery record

### Task 2.1: Tool call ID in the runner's run context

- Modify: `services/runner/src/protocol.ts` (add `tool?: { call_id?: string }` to `RunContext`), `services/runner/src/tools/relay.ts` (in `executeAllowedRelayedTool`, pass `{ ...runContext, tool: { call_id: req.toolCallId } }` to `assembleBody` and `applyContextBindings`; make sure `redactContextBoundArgs` keeps it out of approval keys).
- Test: modify `services/runner/tests/unit/tool-callref-bindings.test.ts`.

1. Write `it("binds $ctx.tool.call_id from the relayed tool call on a direct call")` (the request body holds the relayed ID), `it("keeps the same tool.call_id when the same call is relayed twice")`, and `it("never lets the model choose the tool call id")`.
2. Run `cd services/runner && pnpm vitest run --project unit tests/unit/tool-callref-bindings.test.ts`. The new cases fail.
3. Implement.
4. Run the same command, plus `tests/unit/tool-direct.test.ts`. Both pass.
5. Commit: `feat(runner): bind the tool call id into direct-call run context`.

### Task 2.2: Outbox rows without a thread

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000036_extend_channel_outbox_for_tools.py` (`thread_id` nullable; add `space_id` UUID, backfilled from each row's thread; index `(project_id, space_id, created_at)`).
- Modify: `api/oss/src/core/channels/dtos.py` (`ChannelOutboxEvent.thread_id: Optional[UUID]`, add `space_id`), `api/oss/src/dbs/postgres/channels/dbas.py`, `mappings.py`, `dao.py`, `api/oss/src/tasks/asyncio/channels/outbox.py` (write `space_id` on new turn rows).
- Built as: no `origin` column. A tool send is the row with no thread, so a second column would restate it. For a tool send, `turn_id` holds the tool call ID.
- Test: modify `api/oss/tests/pytest/integration/channels/test_channels_dao_outbox.py`.

1. Write `test_tool_send_row_without_a_thread_round_trips` and `test_duplicate_tool_key_returns_the_existing_row`.
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_outbox.py`. The new cases fail.
3. Implement and apply the migration with `bash ./hosting/docker-compose/run.sh --oss --dev --build`. `--recreate api` alone does not migrate.
4. Run the same command, plus `oss/tests/pytest/integration/channels/test_channels_outbox_worker_integration.py`. Both pass.
5. Commit: `feat(api): let channel outbox rows target a space without a thread`.

### Task 2.3: dropped

The plan moved the claim, post, and receipt code from `ChannelsOutboxWorker._deliver` into `ChannelsService.deliver`, so the worker and the send tool would share it. It was dropped. The send (task 2.4) needs only the existing `record_outbox_event` and `transition_outbox_event`, and moving the worker's code would have risked its behavior for no gain. The send does not use the worker's claim either: a claim can be taken over once it expires, which would let a slow tool call post twice. The one rule both must agree on, when an exception means the outcome is unknown, moved to `delivery_outcome_unknown` in `api/oss/src/core/channels/utils.py`, and both call it.

### Task 2.4: Send to a channel

- Modify: `api/oss/src/core/channels/tools/service.py` (`send_message`: resolve the bot and destination, check the posting setting, check that `thread_id` belongs to the destination, return the stored state when a row for the uuid5 over `session_id:tool_call_id` exists, else insert it with a fresh nonce and post only if this request's insert created the row, post inline through the adapter, record the outcome with `transition_outbox_event`, and return it; a row whose first request never recorded an outcome reports `unknown`), `api/oss/src/core/channels/utils.py` (`delivery_outcome_unknown`, now shared with the outbox worker), `api/oss/src/core/channels/tools/dtos.py` (`ChannelSendResult`).
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_send_message.py`.

1. Write `test_sent_result_has_message_and_thread_ids_and_posts_top_level`, `test_reply_in_a_thread_from_an_earlier_send`, `test_thread_from_another_destination_is_refused`, `test_posting_off_refuses_without_calling_the_adapter`, `test_retry_with_same_tool_call_returns_first_outcome`, `test_unknown_outcome_is_returned_and_not_reposted`, `test_provider_refusal_fails_with_a_sanitized_reason`, `test_unknown_or_foreign_destination_is_not_found`, `test_no_connected_bot_is_refused`, `test_archived_connection_is_refused`, `test_telegram_bot_removed_from_the_group_fails`, and `test_revoked_credential_fails_and_switches_connection_off`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_send_message.py`. It fails.
3. Implement.
4. Run the same command, plus `oss/tests/pytest/unit/channels/test_channels_outbox_worker.py`. Both pass.
5. Commit: `feat(api): send a channel message from any agent run`.

### Task 2.7: The `allow` default for the send tool

- Modify: `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `default_permission: Optional[Literal["allow", "ask"]] = None` to `PlatformOp`, next to `read_only`), `sdks/python/agenta/sdk/agents/tools/interfaces.py` (`PlatformToolResolver.resolve` gains a `permission_default` keyword), `sdks/python/agenta/sdk/agents/tools/resolver.py` (pass `permission_default`), `sdks/python/agenta/sdk/agents/platform/platform_tools.py` (emit `tool_config.permission` when set, else `op.default_permission` only when `permission_default == "allow_reads"`, else `None`).
- Test: create `sdks/python/oss/tests/pytest/unit/agents/platform/test_platform_default_permission.py`.

1. Write `test_op_default_applies_when_author_set_nothing_under_allow_reads` (a test op with `default_permission="allow"` resolves with `permission == "allow"`), `test_author_choice_wins_over_op_default` (`ask` and `deny`), `test_agent_wide_mode_ignores_op_default` (the spec permission is `None`, so the runner applies `ask`), `test_ops_without_default_are_unchanged`, `test_tool_resolver_passes_the_agent_wide_mode`, and `test_default_permission_is_allow_or_ask_only`.
2. Run `cd sdks/python && uv run --no-sync python run-tests.py oss/tests/pytest/unit/agents/platform/test_platform_default_permission.py`. It fails because the field is unknown.
3. Implement.
4. Run the same command, plus `oss/tests/pytest/unit/agents/platform/test_op_catalog.py` and `oss/tests/pytest/unit/agents/tools/test_permission_parity.py`. All pass.
5. Commit: `feat(sdk): per-operation default permission for platform tools`.

### Task 2.8: Send route and SDK catalog entry

- Modify: `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/messages/send`), `api/oss/src/apis/fastapi/channels/models.py`, `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `send_channel_message`, `read_only=False`, `default_permission="allow"`, binding `artifact_id` from `$ctx.workflow.artifact.id`, `session_id` from `$ctx.session.id`, and `tool_call_id` from `$ctx.tool.call_id`; text `maxLength` 40,000; add it to `CHANNEL_TOOL_OPS`).
- Test: extend `api/oss/tests/pytest/unit/channels/test_channels_tools_router.py` and `sdks/python/oss/tests/pytest/unit/agents/platform/test_channel_ops.py`.

1. Write `test_send_rejects_identity_and_routing_fields` and `test_send_returns_the_sanitized_reason` (router), and `test_send_channel_message_is_a_write_and_hides_session_and_tool_call` and `test_send_channel_message_defaults_to_allow` (SDK).
2. Run both files with the commands from task 1.7. The new cases fail.
3. Implement.
4. Run both files. They pass.
5. Commit: `feat(api,sdk): expose send_channel_message as a platform tool`.

---

## Phase 3: Settings UI

### Task 3.1: Client and actions

- Regenerate the TypeScript client against an EE stack so `ChannelAgentData.tools` is typed: `bash ./clients/scripts/generate.sh --language typescript --openapi-url http://localhost/api/openapi.json`.
- Modify: `web/packages/agenta-settings-ui/src/channels/types.ts` (`ChannelToolSettings`; `ChannelsActions.readToolSettings`, `writeToolSettings`, `listMemberChannels`), `src/channels/actions.ts` (read through `fetchChannelAgent`, write through `editChannelAgent` with only `data.tools`), `src/channels/helpers.ts` (`NOOP_ACTIONS`).
- Test: create `web/packages/agenta-settings-ui/tests/unit/channelToolSettings.test.ts`.

1. Write `it("reads the defaults when the bot has no tools block")`, `it("reads a stored narrowed list and posting off")`, `it("writes only data.tools")`, `it("lists only channels the bot is a member of")`, and `it("lists a Telegram bot's stored groups, never its private chats")`.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelToolSettings.test.ts`. It fails.
3. Implement.
4. Run the same command, plus `pnpm types:check`. Both pass.
5. Commit: `feat(frontend): channel tool settings actions`.

### Task 3.2: The Advanced section

- Create: `web/packages/agenta-settings-ui/src/channels/ChannelAdvancedSection.tsx`.
- Modify: `src/channels/ChannelManagePanel.tsx` (render the section collapsed by default, after "Behavior" and the Telegram allow-list and above the Disconnect footer), `src/channels/index.ts`.
- Built as: the posting switch saves when flipped. "Only these channels" shows a checklist and a Save button: on Slack the discovered channels whose membership is `member`, on Telegram the stored group spaces. A failed save shows the error and re-reads the stored value. The section sits above the Disconnect footer, not below it as first planned.
- Test: create `web/packages/agenta-settings-ui/tests/unit/channelAdvancedSection.test.tsx` (the `@agenta/ui/ui` mock pattern of `channelManagePanel.test.tsx`).

1. Write `it("is collapsed by default and loads nothing until opened")`, `it("shows the posting switch on and All channels by default")`, `it("saves only the checked channels under Only these channels")`, `it("shows the error and the stored value after a failed save")`, and `it("explains the Telegram limits")`.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelAdvancedSection.test.tsx`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(frontend): Advanced section with channel tool settings`.

### Task 3.3: Update the old guard test and add stories

- Modify: `web/packages/agenta-settings-ui/tests/unit/channelManagePanel.test.tsx`. The test `shows no read-only settings: no Advanced defaults and no Status row` forbade the word "Advanced". Keep its intent: no read-only defaults and no Status row. Change it to assert that the Advanced section holds only editable controls.
- Modify: `src/channels/ChannelManagePanel.stories.tsx` (Slack default, Slack narrowed, Telegram, posting off).

1. Edit the test so it fails against the old panel and describes the new rule.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelManagePanel.test.tsx`.
3. Add the stories.
4. Run the same command and `pnpm types:check`. Both pass. Then run `cd web && pnpm lint-fix`.
5. Commit: `test(frontend): the Advanced section holds only editable channel settings`.

---

## Phase 4: The read tool

### Task 4.1: Provider time and message reference on stored messages

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000037_add_channel_inbox_sent_at.py` (nullable `sent_at` timestamp column on `channel_inbox_events`, backfilled from `created_at`; index `(project_id, space_id, sent_at, id)`).
- Modify: `api/oss/src/core/channels/dtos.py` (`ChannelInboxEventProcessed.sent_at` and `message_ref`; `ChannelInboxEvent.sent_at`), `api/oss/src/dbs/postgres/channels/dbas.py`, `mappings.py`, `dao.py` (write `sent_at` on every new row: the provider time from `processed.sent_at`, else the arrival time), `api/oss/src/core/channels/adapters/slack/adapter.py` (`parse_event` and `fetch_history` set `sent_at` and `message_ref` from `ts`), `api/oss/src/core/channels/adapters/telegram/adapter.py` (`parse_event` sets them from `date` and `message_id`).
- Built as: no thread expression index. A thread read filters on `data.external_locator.thread_ts` within its space's index. The cost is that a thread whose messages are old, in a very busy channel, reads slower.
- Test: extend `api/oss/tests/pytest/unit/channels/slack/test_slack_adapter.py`, `api/oss/tests/pytest/unit/channels/telegram/test_telegram_adapter.py`, and `api/oss/tests/pytest/integration/channels/test_channels_dao_inbox.py`.

1. Write `test_parse_event_records_ts_as_sent_at_and_message_ref` (Slack), `test_parse_event_records_date_and_message_id` (Telegram), and `test_inbox_event_round_trips_sent_at` (integration).
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_adapter.py`, then the Telegram file, then (after `load-env`) the integration file. The new cases fail.
3. Implement and apply the migration.
4. Run the three commands again. They pass.
5. Commit: `feat(api): record provider time and message reference on channel messages`.

### Task 4.2: Stored message read

- Modify: `api/oss/src/core/channels/interfaces.py` and `api/oss/src/dbs/postgres/channels/dao.py` (`query_space_inbox_messages(project_id, space_id, thread_ts, before, limit)` returns inbox rows of the space, skipping `action` events; `query_space_outbox_messages` returns sent outbox rows found through the new `space_id`; the service merges them by provider time, and a bot post present in both is kept once, from the outbox).
- Built as: consumed rows are not skipped. Pull request #7128, which adds `flags.is_consumed`, is paused and not merged. The filter is a follow-up (task 7.1 in [tasks.md](tasks.md)).
- Test: create `api/oss/tests/pytest/integration/channels/test_channels_dao_space_messages.py`.

1. Write `test_inbox_messages_come_newest_first_by_provider_time`, `test_before_cursor_pages_older_without_gaps`, `test_thread_filter_returns_root_and_replies`, `test_action_events_are_skipped`, and `test_bot_posts_carry_their_thread`. The merge and the single copy of a bot post are tested in the service (task 4.4).
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_space_messages.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): read a channel's stored messages from inbox and outbox`.

### Task 4.3: Live Slack history page

- Modify: `api/oss/src/core/channels/adapters/interface.py` (`read_history(connection, locator, latest, limit)` returns messages, including bot messages, with their `ts`; the default raises `ChannelNotSupported`), `api/oss/src/core/channels/adapters/slack/adapter.py` (call `conversations.history` or `conversations.replies` with `latest` and `inclusive=false`; on HTTP 429 raise `ChannelRateLimited` with the `Retry-After` seconds), `api/oss/src/core/channels/types.py` (`ChannelRateLimited`), `api/oss/tests/pytest/unit/channels/slack/fake_slack.py` (`latest` and a scripted 429).
- Test: create `api/oss/tests/pytest/unit/channels/slack/test_slack_history_pages.py`.

1. Write `test_history_page_returns_only_messages_before_latest_oldest_first`, `test_history_marks_the_bots_own_posts`, `test_replies_page_returns_root_and_replies`, `test_429_raises_rate_limited_with_retry_after`, and `test_missing_scope_raises_backfill_refused`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_history_pages.py`. It fails.
3. Implement.
4. Run the same command, plus `oss/tests/pytest/unit/channels/slack/test_slack_over_fake.py`. Both pass.
5. Commit: `feat(api): fetch one page of older Slack history before a timestamp`.

### Task 4.4: `read_messages` service

- Modify: `api/oss/src/core/channels/tools/service.py` (`read_messages`: check readability; read stored messages; on Slack, when they do not fill the page, make one live call with `latest` set to the oldest stored `ts`; return live messages without storing them; encode every message ID, thread ID, and cursor with the codec from task 1.4; add the notes), `api/oss/src/core/channels/tools/dtos.py`.
- Built as: the default limit (50) and maximum (200) are constants in the service, not environment variables. A live channel page lists only top-level messages, because Slack's channel history shows thread replies only inside their thread, and the result says so. Stored rows and the cursor use one `(time, row id)` order, so pages neither repeat nor skip messages that share a second, and messages are deduplicated by provider reference. Slack's `has_more` decides whether a cursor is returned. A thread read on Slack is live from its root, paging with Slack's cursor, and falls back to the stored thread when Slack rate-limits or refuses.
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_read_messages.py`.

1. Write `test_stored_messages_merge_people_and_bot_oldest_first`, `test_default_limit_is_50_and_max_is_200`, `test_slack_pages_past_stored_messages_with_one_live_call`, `test_live_messages_are_not_stored`, `test_rate_limit_returns_stored_messages_and_retry_note`, `test_result_notes_stored_messages_may_miss_edits`, `test_thread_read_returns_root_and_replies`, `test_unreadable_channel_is_refused_without_calling_slack`, `test_direct_message_space_is_refused`, `test_thread_of_another_channel_is_not_found`, `test_no_raw_slack_ids_in_output`, and `test_telegram_returns_stored_only_with_history_note`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_read_messages.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): read channel messages, stored first then live Slack`.

### Task 4.5: Read route and SDK catalog entry

- Modify: `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/messages/read`), `api/oss/src/apis/fastapi/channels/models.py`, `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `read_channel_messages`, `read_only=True`, add it to `CHANNEL_TOOL_OPS`).
- Test: extend `api/oss/tests/pytest/unit/channels/test_channels_tools_router.py` and `sdks/python/oss/tests/pytest/unit/agents/platform/test_channel_ops.py`.

1. Write `test_read_rejects_a_limit_over_200` (router) and `test_read_channel_messages_is_read_only_and_hides_artifact_binding` (SDK).
2. Run both files with the commands from task 1.7. The new cases fail.
3. Implement.
4. Run both files. They pass.
5. Commit: `feat(api,sdk): expose read_channel_messages as a platform tool`.

---

## Phase 5: Search

### Task 5.1: Full-text expression index

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000038_add_channel_inbox_search_index.py` (GIN index `ix_channel_inbox_events_search` on `to_tsvector('simple', coalesce(data #>> '{processed,content,0,text}', ''))`, created `CONCURRENTLY` in an autocommit block).
- Modify: `api/oss/src/dbs/postgres/channels/dao.py` (`_SEARCH_VECTOR`, the one spelling of the indexed expression, and `search_inbox_statement(project_id, space_ids, query, after, before, limit, offset)` using `websearch_to_tsquery('simple', ...)`, skipping `action` events, ordered by rank, `sent_at`, and `id`), `api/oss/src/core/channels/interfaces.py`.
- Built as: paging uses an offset over that total order. A message stored between two pages can shift a later page by one row. Consumed rows are not skipped until pull request #7128 merges (task 7.1 in [tasks.md](tasks.md)).
- Test: create `api/oss/tests/pytest/integration/channels/test_channels_dao_message_search.py`.

1. Write `test_search_matches_words`, `test_search_filters_by_space_and_time`, `test_offset_pages_are_stable_for_equal_rank_and_time`, `test_search_is_project_scoped`, and `test_query_uses_the_expression_index` (an `EXPLAIN` of the search names the new index).
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_message_search.py`. It fails.
3. Implement and apply the migration.
4. Run the same command. It passes.
5. Commit: `feat(api): full-text index over stored channel messages`.

### Task 5.2: `search_channel_messages`

- Modify: `api/oss/src/core/channels/tools/service.py` (`search_messages`: compute readable channel spaces at call time, excluding direct messages, intersect them with the requested destinations, and return a `searched` list with a `coverage` statement per channel), `api/oss/src/core/channels/tools/dtos.py`, `api/oss/src/apis/fastapi/channels/tools.py` (`POST /tools/messages/search`), `models.py`, `sdks/python/agenta/sdk/agents/platform/op_catalog.py` (add `search_channel_messages`, `read_only=True`, default limit 20 and maximum 50, add it to `CHANNEL_TOOL_OPS`).
- Built as: the Slack coverage reads "Searched messages since the bot joined this channel." and the Telegram coverage reads "Searched only the messages the bot received in this group." Search makes no Slack history or search call. It may refresh the Slack member channel list to know which channels are readable.
- Test: create `api/oss/tests/pytest/unit/channels/tools/test_search_messages.py`. Extend `test_channels_tools_router.py` and `test_channel_ops.py`.

1. Write `test_search_without_destinations_covers_all_readable_channels`, `test_narrowed_channel_is_excluded_immediately`, `test_reading_off_refuses_search`, `test_foreign_destination_returns_no_matches`, `test_destination_filter_narrows_to_one_channel`, `test_direct_messages_are_never_searched`, `test_result_says_searched_messages_since_the_bot_joined`, `test_telegram_group_covers_only_messages_the_bot_received`, `test_search_never_calls_the_provider_for_messages`, `test_unknown_sender_name_is_omitted_not_raw`, `test_results_carry_a_thread_to_read`, and `test_cursor_pages_without_repeats`. In the router file, write `test_search_rejects_a_limit_over_50`; in the SDK file, `test_search_channel_messages_is_read_only_and_limited_to_50`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/tools/test_search_messages.py`. It fails.
3. Implement.
4. Run the same command, the router test, and the SDK `test_channel_ops.py`. All pass.
5. Commit: `feat(api,sdk): search_channel_messages over stored messages`.

---

## Verification: live QA

Run on a local EE stack (`load-env hosting/docker-compose/ee/.env.ee.dev` and `bash ./hosting/docker-compose/run.sh --ee --dev --build`). Use a fresh Slack workspace with a custom app built from the generated manifest, the hosted Slack app, a fresh Telegram bot, and the hosted Telegram bot. Record an MP4 of each flow and keep sanitized request and response evidence under `~/`, not `/tmp`.

The Agenta tools kit is not built yet, so the tools are not added automatically. Add the four tools to the agent's tools explicitly: `{"type": "platform", "op": "list_channel_destinations"}`, and the same for `send_channel_message`, `read_channel_messages`, and `search_channel_messages`.

**Slack**

1. Connect the bot and add the four tools to the agent's tools. `POST /api/channels/tools/availability` returns `{"available": true}`. Disconnect the bot: the same call returns `{"available": false}`, and every tool call is refused. Reconnect it.
2. Invite the bot to one public and one private channel. Ask the agent in Agenta chat: "Where can you post?" The list shows both channels and no channel the bot is not in.
3. "Post 'QA hello' in #qa-public." No approval card appears. The message is in Slack, and the result says `sent` with a thread ID.
4. In the agent's tools, set `send_channel_message` to `ask` and post again. The approval card appears, and nothing is posted until it is approved. Put the setting back.
5. Set the agent-wide permission mode to `ask` and post. The approval card appears. Set it back.
6. Run an automation (a schedule) that asks the agent to post to #qa-public. It posts with no prompt.
7. "Reply in the thread from step 3 with 'follow-up'." It lands in the thread.
8. Post a few messages in #qa-private as a person. "Read the last 100 messages in #qa-private." The stored messages come first, including the bot's own posts, then older messages fetched live from Slack. On the custom app, page back several times. On the hosted app, page back twice within a minute: the second call returns the stored messages and the "about one history request per minute" note.
9. Edit and delete a message the bot stored. Read again. The stored part still shows the original text, and the result carries the note that stored messages may miss edits and deletions.
10. "Search for 'QA hello'." It finds the message, and the result says "Searched messages since the bot joined this channel." Search for a word used only before the bot joined. Nothing is found.
11. In Advanced, turn off "Can post outside the conversation". A send is refused, and a mention in a thread is still answered.
12. Narrow reading to #qa-public. A read or search of #qa-private is refused at once.

**Telegram**

1. Add the bot to a group and send a message there.
2. "Where can you post?" The list shows the group by its title, with the note that Telegram allows no more.
3. "Post 'QA hello' in the group." It arrives.
4. "Read the group." Only messages the bot received appear, and the result says Telegram does not let bots read history. With privacy mode on, only messages addressed to the bot appear, and the note says why.
5. Remove the bot from the group and send again. The result is `failed` with a readable reason.
6. Repeat steps 2 and 3 on the hosted Telegram bot. Only chats bound to this project are listed.

**Isolation and truthfulness**

- Copy a destination ID from project A into a run in project B. The result is not found.
- Block outbound traffic to `slack.com` during a send so the request times out. The result is `unknown`, and the runner's retry does not post twice.

## Risks

- **Posting without a human in the loop** follows from the `allow` default, and, once the kit ships, from the kit making the tools available in every run of a connected agent. A prompt injection in any channel the bot reads can make the agent post elsewhere. Mitigations are the posting setting, a per-tool or agent-wide `ask`, the operator kill switch, and the outbox record.
- **Slack's history limit for the hosted app** makes reading older history slow: about one live page of 15 messages per minute. It is accepted, and the read result says so. Customer-built apps are not affected.
- **Search sees only stored messages.** Anything from before the bot joined is not searchable until the history copy in Future work ships. Every result says what it searched.
- **Stored text can be stale.** Slack edits and deletions do not reach stored rows, so search can still find a deleted message. The read result notes it.
- **The Agenta tools kit and retention specifications are not approved yet.** The assumptions in `design.md` must be checked when they land.
- **Consumed rows appear in reads and searches.** Pull request #7128, which adds `is_consumed`, is paused and not merged. Once it merges, add the filter to `query_space_inbox_messages` and `search_inbox_statement` in `api/oss/src/dbs/postgres/channels/dao.py` (task 7.1 in [tasks.md](tasks.md)).
- **Private-to-public leaks** follow from the permissive default. The only mitigation in v1 is the read list.
- **Every run has a session, so duplicate-post protection always applies.** The triggers dispatcher mints a session ID per delivery (`session_id = uuid4().hex` in `api/oss/src/tasks/asyncio/triggers/dispatcher.py`), and the runner falls back to a generated ID when a request names none (`resolveRunSessionId` in `services/runner/src/protocol.ts`; `run-turn.ts` binds `session.id` from it). So the send's key over session and tool call ID applies in automation runs too.
- **The old UI test** that forbade an Advanced section (task 3.3) encoded an earlier decision to hide read-only defaults. The new section keeps that rule.
- **The search index migration** uses `CREATE INDEX CONCURRENTLY`, so it runs in an autocommit block outside the migration transaction.
