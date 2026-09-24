# Channel message retention: implementation plan

**Goal:** Delete stored Slack and Telegram messages after a retention period, delete a disconnected bot's messages after a grace period, and delete a space's messages when the space is deleted, without breaking replies in flight or the next turn's starting point.

**Architecture:** A `ChannelsRetentionService` in `api/oss/src/core/channels/retention.py` runs one sweep: for each project with a channel connection, it deletes old received messages, replies and triggers in batches, then purges connections archived for longer than the grace period. A `ChannelsRetentionDAO` in `api/oss/src/dbs/postgres/channels/retention_dao.py` holds the deletes. An admin route, `POST /admin/channels/messages/sweep`, runs the sweep. A new cron entry, `api/oss/src/crons/channels.sh`, calls it every hour, the same way `gateways.sh` calls its sweep. Space deletion reuses the DAO's delete helpers in the same transaction.

**Tech stack:** Python 3 with FastAPI, Pydantic, SQLAlchemy and Alembic (API); PostgreSQL; supercronic (cron container); React with Vitest (`@agenta/settings-ui`).

Read [design.md](design.md) first. Each phase ships as its own pull request, in this order. Phase 1 alone delivers the periodic cleanup. Phase 2 depends on phase 1. Phase 3 depends only on the configuration from task 1.1, and should ship no later than phase 2, so the disconnect confirmation tells the truth from the day the purge exists.

## Conventions used in every task

Commands run from the repository root unless a `cd` is shown.

- **API unit test:** `cd api && uv run --no-sync python run-tests.py <path>[::<test>]`. Run `uv sync --locked` once first.
- **API integration test** (needs the local Postgres; see `hosting/AGENTS.md`): `load-env hosting/docker-compose/oss/.env.oss.dev`, then `cd api && uv run --no-sync python run-tests.py <path>[::<test>]`.
- **Settings UI unit test:** `cd web/packages/agenta-settings-ui && pnpm vitest run <path>`.
- **Before each commit:** `cd api && ruff format && ruff check --fix` for API changes. Run `cd web && pnpm lint-fix` for web changes. In a GitButler workspace, commit with `but commit <branch> -m "<message>"`. Otherwise use `git commit -m "<message>"`.
- New integration tests use the `channels_scope` fixture in `api/oss/tests/pytest/integration/channels/conftest.py`. They write rows with a chosen `created_at` and a UUIDv7 `id` minted for that instant, through a small helper added in task 1.3 (`api/oss/tests/pytest/integration/channels/aging.py`).
- The migration number below assumes `oss000000035` is still the head of `api/oss/databases/postgres/migrations/core_oss/versions/`. Take the next free number at implementation time.
- PR #7128 (`fix/channels-mention-only-threads`) changes `fetch_latest_trigger`. If it has merged, task 1.2 moves its `never_admitted` condition into the shared predicate. If not, the predicate admits every trigger, and #7128 must use the shared predicate when it rebases.

Every task follows five steps: (1) write the failing test, (2) run it and see it fail, (3) implement, (4) run it and see it pass, (5) commit. When the run command is the same for steps 2 and 4, it is written once.

---

## Phase 1: Periodic cleanup

PR title: `feat(api): delete stored channel messages after a retention period`. Size: M, 9 tasks, about 3 to 4 days.

### Task 1.1: Retention configuration

- Modify: `api/oss/src/utils/env.py` (add `ChannelsRetentionConfig` with `message_retention_days` from `AGENTA_CHANNELS_MESSAGE_RETENTION_DAYS`, default 30, `ge=0`; `disconnect_purge_days` from `AGENTA_CHANNELS_DISCONNECT_PURGE_DAYS`, default 7, `ge=0`; `batch_size` from `AGENTA_CHANNELS_RETENTION_BATCH_SIZE`, default 1000, `ge=1`; `time_budget_seconds` from `AGENTA_CHANNELS_RETENTION_TIME_BUDGET_SECONDS`, default 600, `ge=1`; all with `validate_default=True`, as in `SessionsRecordsConfig`; add `retention: ChannelsRetentionConfig` to `ChannelsConfig`).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_retention_env.py`.

1. Write `test_retention_defaults` (30, 7, 1000, 600), `test_zero_turns_cleanup_off`, and `test_negative_days_fail_validation` (use `monkeypatch.setenv` and build `ChannelsRetentionConfig()` directly, as `telegram/test_telegram_hosted_env.py` does).
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_retention_env.py`. It fails on import.
3. Add the config.
4. Run the same command. It passes.
5. Commit: `feat(api): channels retention settings`.

### Task 1.2: One predicate for "counts as an offset"

- Create: `api/oss/src/dbs/postgres/channels/offsets.py` (`trigger_counts_as_offset()` returns the SQLAlchemy condition `fetch_latest_trigger` filters on; on today's `main` it is `true()`).
- Modify: `api/oss/src/dbs/postgres/channels/dao.py` (`fetch_latest_trigger` filters on `trigger_counts_as_offset()`).
- Test: modify `api/oss/tests/pytest/integration/channels/test_channels_dao_triggers.py`.

1. Write `test_fetch_latest_trigger_uses_the_shared_offset_predicate` (records triggers in every state, including a FAILED `never_sent` one when #7128 is in, and checks `fetch_latest_trigger` returns the newest row the predicate admits).
2. Run `load-env hosting/docker-compose/oss/.env.oss.dev`, then `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_triggers.py`. The new test fails on import.
3. Extract the predicate.
4. Run the same command. Every test in the file passes.
5. Commit: `refactor(api): share the channel trigger offset predicate`.

### Task 1.3: Retention DAO, periodic deletes

- Create: `api/oss/src/dbs/postgres/channels/retention_dao.py` (`ChannelsRetentionDAO` with `list_channel_project_ids(after, limit)` from `channel_connections`, archived rows included; `delete_old_triggers(project_id, cutoff, limit)`; `delete_old_outbox_events(project_id, cutoff, limit)`; `delete_old_inbox_events(project_id, cutoff, limit)`. Each delete is `DELETE ... WHERE (project_id, id) IN (SELECT ... LIMIT :limit)` bounded by `id < uuid7_floor(cutoff)` and `created_at < cutoff`, and returns the row count. The trigger delete skips STARTED rows and, per thread, the newest row by `event_id` that `trigger_counts_as_offset()` admits. The outbox delete keeps rows that are not SENT, FAILED or ABANDONED, rows whose `status.code` is `sending` or `delivery_uncertain`, and rows an active thread's `data.pending_choice.outbox_event_id` names), `api/oss/src/dbs/postgres/channels/uuid7.py` (`uuid7_floor(instant)`: the smallest UUIDv7 for a millisecond).
- Modify: `api/oss/src/core/channels/interfaces.py` (add `ChannelsRetentionDAOInterface`).
- Create: `api/oss/tests/pytest/integration/channels/aging.py` (helpers that insert inbox events, triggers and outbox rows at a given age), and the test file `api/oss/tests/pytest/integration/channels/test_channels_retention_dao.py`.

1. Write `test_deletes_inbox_events_older_than_cutoff_only`, `test_deletes_unrouted_inbox_events`, `test_batch_limit_is_respected`, `test_other_project_untouched`, `test_keeps_starting_point_trigger_per_thread`, `test_starting_point_skips_refused_trigger` (with #7128), `test_keeps_started_trigger`, `test_keeps_created_claimed_and_uncertain_outbox_rows`, `test_keeps_outbox_row_of_open_choice`, `test_row_with_old_created_at_but_new_id_is_kept` (the double bound), and `test_thread_rows_are_never_deleted`.
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_retention_dao.py`. It fails on import.
3. Implement the DAO and the helper.
4. Run the same command. It passes.
5. Commit: `feat(api): batched deletes for old channel messages`.

### Task 1.4: Retention service

- Create: `api/oss/src/core/channels/retention.py` (`ChannelsRetentionService.sweep(now=None) -> ChannelsRetentionResult`: pages through project IDs; for each project, loops trigger, outbox, then inbox deletes until a batch returns fewer rows than `batch_size`; stops when `time_budget_seconds` has passed; skips the periodic part when `message_retention_days == 0`; logs one summary line with the counts).
- Modify: `api/oss/src/core/channels/dtos.py` (`ChannelsRetentionResult` with `inbox`, `outbox`, `triggers`, `threads`, `connections`).
- Test: create `api/oss/tests/pytest/unit/channels/test_channels_retention_service.py` with an in-memory fake of `ChannelsRetentionDAOInterface`.

1. Write `test_cutoff_is_now_minus_period`, `test_loops_until_a_short_batch`, `test_stops_at_the_time_budget` (a fake clock), `test_period_zero_skips_periodic_deletes`, `test_triggers_are_deleted_before_inbox_events`, and `test_counts_are_summed_across_projects`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_retention_service.py`. It fails on import.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): channels retention sweep`.

### Task 1.5: The next turn after a cleanup

- Test: modify `api/oss/tests/pytest/integration/channels/test_channels_service_routing_dao.py`.

1. Write `test_mention_after_cleanup_reads_only_messages_since_last_turn`: a thread whose last SETTLED turn is 40 days old, replies stored 35, 20 and 5 days ago, a 30-day sweep, then `select_forwardfill_range` for a new mention returns the replies from 20 and 5 days ago and the mention, and nothing older.
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_service_routing_dao.py::test_mention_after_cleanup_reads_only_messages_since_last_turn`. It passes only if tasks 1.2 to 1.4 are right. Check that it fails when the starting-point exclusion is removed from `delete_old_triggers`, then restore it.
3. No new code.
4. Run the same command. It passes.
5. Commit: `test(api): turn context after channel retention cleanup`.

### Task 1.6: History copies stop at the cutoff

- Modify: `api/oss/src/core/channels/adapters/interface.py` (`fetch_history(..., oldest: Optional[datetime] = None)`), `api/oss/src/core/channels/adapters/slack/adapter.py` (send `oldest` as a Slack timestamp to `conversations.history` and `conversations.replies`), every other adapter's `fetch_history` signature (`telegram`, `bridge`, `mock`, `agenta`; `telegram_hosted` inherits from `telegram`), `api/oss/src/core/channels/fill.py` (`run_backfill` computes the cutoff from `env.channels.retention.message_retention_days` and passes it, or `None` when the value is `0`).
- Modify: `api/oss/tests/pytest/unit/channels/slack/fake_slack.py` (record the `oldest` parameter).
- Test: modify `api/oss/tests/pytest/unit/channels/test_channels_fill.py` and `api/oss/tests/pytest/unit/channels/slack/test_slack_over_fake.py`.

1. Write `test_backfill_passes_retention_cutoff_as_oldest`, `test_backfill_passes_no_oldest_when_cleanup_is_off`, and, in the Slack file, `test_fetch_history_sends_oldest`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_fill.py` and `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/slack/test_slack_over_fake.py`. The new tests fail.
3. Implement.
4. Run both commands, plus `oss/tests/pytest/unit/channels/slack/test_slack_contract_suite.py`. All pass.
5. Commit: `feat(api): bound channel history copies by the retention period`.

### Task 1.7: Admin route

- Modify: `api/oss/src/apis/fastapi/channels/router.py` (`ChannelsRouter.__init__` takes an optional `retention_service`; add `self.admin_router` with `POST /messages/sweep` → `sweep_channel_messages`, returning the result counts), `api/entrypoints/routers.py` (build `ChannelsRetentionService(retention_dao=ChannelsRetentionDAO(), config=env.channels.retention)` next to `channels = ChannelsRouter(` and mount `channels.admin_router` under `prefix="/admin/channels"`, `include_in_schema=False`, as `mcp_gateway_router.admin_router` is mounted).
- Test: modify `api/oss/tests/pytest/unit/channels/test_channels_connections_router.py` (mocked request, same pattern).

1. Write `test_sweep_route_returns_counts` and `test_sweep_route_is_on_the_admin_router_only` (the path is absent from `router.routes`).
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_connections_router.py`. The new tests fail.
3. Implement.
4. Run the same command. It passes. Then deploy (`bash ./hosting/docker-compose/run.sh --oss --dev --build`) and run `curl -s -X POST -H "Authorization: Access $AGENTA_AUTH_KEY" http://localhost/api/admin/channels/messages/sweep`. It returns counts. The same call without the header returns 401.
5. Commit: `feat(api): admin route for the channels retention sweep`.

### Task 1.8: Cron entry

- Create: `api/oss/src/crons/channels.sh` (copy of `gateways.sh`, calling `http://api:8000/admin/channels/messages/sweep` with `--max-time 900`), `api/oss/src/crons/channels.txt` (`15 * * * * root sh /channels.sh >> /proc/1/fd/1 2>&1`).
- Modify: `api/oss/docker/Dockerfile.dev`, `api/oss/docker/Dockerfile.gh`, `api/ee/docker/Dockerfile.dev`, `api/ee/docker/Dockerfile.gh` (copy both files and add `/etc/cron.d/channels-cron` to the crontab generation loop), `hosting/docker-compose/oss/docker-compose.dev.yml`, `hosting/docker-compose/ee/docker-compose.dev.yml` (mount `channels.sh` into the `cron` service).
- Test: none automated. The check is the built image.

1. Build: `bash ./hosting/docker-compose/run.sh --oss --dev --build`.
2. Run `docker compose -p <project> exec cron cat /app/crontab`. Before the change, it has no `channels.sh` line.
3. Add the files.
4. Rebuild and run the same command. The line `15 * * * * sh /channels.sh` is there. Run `docker compose -p <project> exec cron sh /channels.sh`. It prints "completed successfully". Repeat the crontab check on the EE stack (`load-env hosting/docker-compose/ee/.env.ee.dev` + `run.sh --ee --dev --build`).
5. Commit: `feat(hosting): hourly channels retention cron`.

### Task 1.9: Configuration reference

- Modify: `docs/docs/self-host/reference/01-configuration.mdx` (Channels section: add the four variables, their defaults, what `0` means for the two day values, and that they are read by the `api` container only).
- Test: `cd docs && pnpm build` succeeds.

1. Write the rows.
2. Run `cd docs && pnpm build`.
3. Fix any broken link.
4. Run it again. It passes.
5. Commit: `docs(self-host): channels retention variables`.

---

## Phase 2: Disconnect purge and space deletion

PR title: `feat(api): delete a disconnected bot's stored messages`. Size: M, 5 tasks, about 2 to 3 days.

### Task 2.1: Index for replies by connection

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000036_index_channel_outbox_connection.py` (`ix_channel_outbox_events_connection` on `channel_outbox_events (project_id, connection_id, id)`; downgrade drops it).
- Modify: `api/oss/src/dbs/postgres/channels/dbes.py` (declare the index on `ChannelOutboxEventDBE`).
- Test: modify `api/oss/tests/pytest/integration/channels/test_channels_default_indexes.py`.

1. Write `test_outbox_has_connection_index` (reads `pg_indexes`).
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_default_indexes.py`. It fails.
3. Add the migration. Apply it with `bash ./hosting/docker-compose/run.sh --oss --dev --build`. `--recreate api` alone does not migrate.
4. Run the same command. It passes.
5. Commit: `feat(api): index channel replies by connection`.

### Task 2.2: Connection purge in the DAO

- Modify: `api/oss/src/dbs/postgres/channels/retention_dao.py` (`purge_connection_batch(project_id, connection_id, limit)`: deletes, in batches, the triggers of the connection's threads, the connection's replies except those in flight, the connection's received messages (routed or not), then the thread rows of the connection's spaces; returns counts per table and whether anything is left; `list_connections_to_purge(project_id, archived_before)`: archived connections whose `deleted_at` is before the bound and whose `data.messages_purged_at` is missing or older than `deleted_at`; `mark_connection_purged(project_id, connection_id, at)`).
- Test: modify `api/oss/tests/pytest/integration/channels/test_channels_retention_dao.py`.

1. Write `test_purge_deletes_messages_replies_triggers_and_threads`, `test_purge_keeps_connection_agents_spaces_grants_and_identity_links`, `test_purge_keeps_replies_in_flight`, `test_purge_leaves_other_connections_alone`, `test_lists_only_connections_past_the_bound`, and `test_rearchived_connection_is_listed_again`.
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_retention_dao.py`. The new tests fail.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): purge a disconnected connection's channel messages`.

### Task 2.3: Purge in the sweep

- Modify: `api/oss/src/core/channels/retention.py` (after the periodic part of each project, purge connections archived before `now - disconnect_purge_days`, then mark them; skip when `disconnect_purge_days == 0`; share the time budget).
- Test: modify `api/oss/tests/pytest/unit/channels/test_channels_retention_service.py`.

1. Write `test_purges_connection_past_grace`, `test_restored_connection_is_not_purged`, `test_marks_connection_after_purge`, `test_grace_zero_disables_purge`, and `test_purge_resumes_after_time_budget`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_retention_service.py`. The new tests fail.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): disconnect purge in the channels retention sweep`.

### Task 2.4: Reconnect after a purge

- Test: modify `api/oss/tests/pytest/integration/channels/test_channels_connection_write_path_integration.py`.

1. Write `test_unarchive_after_purge_restores_settings_not_messages` (archive, back-date `deleted_at` by 8 days, sweep, unarchive; agents, spaces and grants are back; `query_inbox_events` and `query_threads` are empty; the space's `is_backfilled` is still true) and `test_unarchive_within_grace_keeps_everything`.
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_connection_write_path_integration.py`. They pass only if phase 2 is right. Check the first fails with the purge disabled.
3. No new code, unless a restore path needs a fix.
4. Run the same command. It passes.
5. Commit: `test(api): channel reconnect before and after the purge`.

### Task 2.5: Space deletion

- Modify: `api/oss/src/dbs/postgres/channels/dao.py` (`delete_space` deletes, in the same session, the space's triggers, replies (except in flight), received messages and thread rows, using the helpers from `retention_dao.py`, then the space).
- Test: modify `api/oss/tests/pytest/integration/channels/test_channels_dao_roundtrip.py`.

1. Write `test_delete_space_removes_its_messages_and_threads` and `test_delete_space_keeps_other_spaces_messages`.
2. Run (after `load-env`) `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_dao_roundtrip.py`. The new tests fail.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): delete a channel space's messages with the space`.

---

## Phase 3: What people see

PR title: `feat(frontend): show channel message retention`. Size: S, 2 tasks, about 1 day.

### Task 3.1: Retention values on the connection response

- Modify: `api/oss/src/core/channels/dtos.py` (`ChannelConnectionResponse` and `ChannelConnectionsResponse` gain `message_retention_days: int` and `disconnect_purge_days: int`), `api/oss/src/apis/fastapi/channels/router.py` (fill both from `env.channels.retention`).
- Test: modify `api/oss/tests/pytest/unit/channels/test_channels_connections_router.py`.

1. Write `test_connection_response_carries_retention_values` (with `monkeypatch` on the config).
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_connections_router.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): expose channel retention values`.

### Task 3.2: Settings copy

- Regenerate the TypeScript client against an EE stack: `bash ./clients/scripts/generate.sh --language typescript --openapi-url http://localhost/api/openapi.json`.
- Modify: `web/packages/agenta-settings-ui/src/channels/types.ts` (the two values on the connection), `src/channels/actions.ts` (read them), `src/channels/ChannelManagePanel.tsx` (the disconnect confirmation at the "Past conversations stay in Agenta." line, and the retention line in the panel), `src/channels/storyFixtures.tsx`.
- The wording is Mahmoud's decision (design decision 6). Until he approves it, use a clearly marked placeholder string and do not merge.
- Test: modify `web/packages/agenta-settings-ui/tests/unit/channelsDisconnect.test.tsx` and `tests/unit/channelManagePanel.test.tsx`.

1. Write `it("states the grace period in the disconnect confirmation")`, `it("says messages are kept when the grace period is 0")`, and `it("shows the deployment's retention period in the panel")`.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelsDisconnect.test.tsx tests/unit/channelManagePanel.test.tsx`. The new tests fail.
3. Implement with the approved wording.
4. Run the same command, plus `pnpm types:check`. Both pass.
5. Commit: `feat(frontend): show channel message retention in settings`.

---

## Verification: live QA

On the local OSS dev stack with a Slack test workspace and a Telegram test bot.

1. Mention the bot in a Slack thread, then post two unaddressed replies. In PostgreSQL, set `created_at` of the first mention, its trigger and its reply to 40 days ago, and of one reply to 35 days ago. Set their `id` values with the same UUIDv7 floor the DAO uses.
2. Call the sweep route. The counts show the deleted rows. The thread row and its starting-point trigger remain.
3. Mention the bot again and ask what was said since it last answered. It knows only the reply from within the period.
4. Disconnect the bot. Call the sweep. Nothing is deleted. Unarchive. Everything is back and the thread continues its session.
5. Disconnect again. Set `deleted_at` to 8 days ago. Call the sweep. The messages, replies, triggers and threads of that connection are gone. Other connections are unchanged.
6. Reconnect. The bot answers in the same channels. A mention in the old thread starts a new session. No history is imported again.
7. Delete one space in the classic settings. Its rows are gone. Another space's rows are still there.
8. Repeat steps 4 to 6 with the Telegram bot.
9. Watch the cron container logs across one hour. `channels.sh` runs at minute 15 and reports success.

## Risks

- **The starting-point rule** must match `fetch_latest_trigger`. Task 1.2 makes them share one predicate, and task 1.5 fails if they drift.
- **PR #7128 and this change both touch `fetch_latest_trigger`.** Whichever merges second rebases onto the shared predicate.
- **UUIDv7 bound.** A row inserted with an ID from another generator is protected by the `created_at` check, but it is found only by a full scan of its project. Every channels write uses the default generator today.
- **First run on a large deployment.** The 10-minute budget spreads the backlog over several runs. Watch the first day of cron logs.
- **Migration numbers** can collide with other pull requests, including `channel-agent-tools`. Renumber at implementation time.
- **The `channel-agent-tools` history table.** If it lands, add `channel_messages` to the periodic and disconnect deletes in the same pattern.
