# Tasks

Status: M1 (group 1) and 6.2 done. The tasks follow the four pull requests in the design. M4 ships in the same release as M2, because without recovery a failed resume loses messages.

Parallel work: M1 and the core half of M2 (group 2) can start at the same time, because they touch different files. M3 can start once M1's capability declaration and setup document are merged. Group 4 needs group 3. The docs group can start with M1 and finish with M3. Live QA runs last.

## 1. M1: Discord adapter (PR 1, can run in parallel with group 2)

- [x] 1.1 Add `api/oss/src/core/channels/adapters/discord/capabilities.py` with the v1 declaration in design.md (commands not native, `update: false`, `ephemeral: false`, `indicator: "native"`, no files, identity keys `application_id` / `guild_id, channel_id` / `guild_id, channel_id, thread_id`).
- [x] 1.2 Add `mapping.py`: locator building with `guild_id`, `channel_id` (the text channel), `thread_id`, `source_channel_id` and `message_id` (D7: a mention sets `thread_id` to its message id; a message inside a thread sets `channel_id` to the parent channel), reply target `thread_id` else `channel_id`, bot echo detection, mention detection with `bot_user_id`, a fixed-width safety-net split at 2,000 characters (core's shared `_split_text` splits answers; M1 makes it keep a code block whole when it fits), and button action rows.
- [x] 1.3 Add `adapter.py`: `verify_connection` with `GET /applications/@me` and the Message Content flag check, `build_setup_document` with the invite URL, `connection_locator` returning `None`, `verify_signature` raising `NotImplementedError`.
- [x] 1.4 Implement `parse_event` for `MESSAGE_CREATE` and button `INTERACTION_CREATE`, with the deferred update (callback type `6`) sent before it returns. For a message inside a thread, read the thread's channel object through a small cache per connection to set `channel_id` to its parent channel and `thread_id` to the thread. `verify_connection` stores `bot_user_id`, `bot_username` and `application_name`, and refuses with `ChannelConnectionVerificationFailed`.
- [x] 1.5 Implement outbound REST over `httpx`: `post_message` (start the thread from the message when needed), `dismiss_choices`, `signal_activity` (typing), `set_message_status` (reaction), `fetch_history`, `discover_spaces` returning nothing.
- [x] 1.6 Register `"discord": DiscordAdapter()` in `api/entrypoints/channel_adapters.py`.
- [x] 1.7 Unit tests under `api/oss/tests/pytest/unit/channels/discord/`, following `whatsapp/`: a `fake_discord.py` REST fake and `payloads.py`, then `test_discord_capabilities.py` (normalisation, key composition with `guild_id` `""`), `test_discord_mapping.py` (locators, splitting, code blocks, buttons), `test_discord_adapter.py` (token check, intent check, invite URL, deferred update, echo drop, ids).
- [x] 1.8 Add the Discord case to the shared contract tests in `api/oss/tests/pytest/unit/channels/contract/` and `test_channel_adapter_registry.py`.
- [x] 1.9 Approval round trip in the outbox and dispatcher tests: the `custom_id` is `<interaction UUID>:approve`, a click resolves the pending choice, and a stale click starts no turn.

## 2. M2 core: shared store-and-enqueue step (PR 2, can run in parallel with group 1)

- [x] 2.1 Add `ChannelInboxEnqueueFailed` to `api/oss/src/core/channels/types.py`.
- [x] 2.2 Add `ChannelsService.record_and_enqueue_inbox_event` with the body of `ChannelsIngressRouter._record_and_enqueue`, and the attribute `ChannelsService.inbox_dispatch_task`, set at wiring.
- [x] 2.3 Switch `_ingest` and `_ingest_hosted` in `ingress.py` to the service method, delete `_record_and_enqueue`, and map `ChannelInboxEnqueueFailed` to 503 in `handle_channel_adapter_exceptions`.
- [x] 2.4 Set `channels_service.inbox_dispatch_task = _channels_inbox_worker.dispatch_inbox_event` in `api/entrypoints/routers.py` after `_channels_inbox_worker` is built, next to `triggers_service.schedule_dispatch_task` (`routers.py:1144`).
- [x] 2.5 Add `ChannelsService.query_active_connections(channel)` returning `List[Tuple[UUID, ChannelConnection]]`, project_id first, and its DAO query (cross-project, active, verified, not archived), following `fetch_active_schedules_with_project`.
- [x] 2.6 Unit tests: `test_channels_ingress.py` and `test_whatsapp_ingress.py` still pass with the same status codes; new tests for the service method (new row, existing row still enqueues, timeout raises `ChannelInboxEnqueueFailed`, no task stores only) and for `query_active_connections`.

## 3. M2 loop: socket loop in worker-queues (PR 2, after group 2)

- [x] 3.1 Add `discord.py==2.7.1` to `api/pyproject.toml` and update `api/uv.lock`.
- [x] 3.2 Add the socket loop module `api/oss/src/tasks/asyncio/channels/discord_socket.py` with the lock (`channels`, `discord:sockets`), renew and release, the reload on a short interval, one `discord.py` client per connection, and close on lock loss.
- [x] 3.3 Feed each dispatch through `parse_event` and `record_and_enqueue_inbox_event`; retry `ChannelInboxEnqueueFailed` for the same event with backoff while the socket keeps reading.
- [x] 3.4 Handle close code `4014` with an error log and backoff.
- [x] 3.5 Start the loop in `worker_queues.main_async` when `channels-inbox` is selected, keep the `ChannelsInboxWorker` reference, and set `inbox_dispatch_task` on the loop's `ChannelsService`. Stop the loop on shutdown.
- [x] 3.6 Unit tests under `api/oss/tests/pytest/unit/channels/discord/`: `test_discord_socket_lock.py` (one holder, lock loss closes sockets), `test_discord_socket_reload.py` (open, restart on token change, close on archive), `test_discord_socket_enqueue_retry.py` (same `external_id` retried, reading continues), and a `worker_queues` test that the loop starts only with `channels-inbox`.

## 4. M4: recovery after a failed resume (ships with M2, after group 3)

- [x] 4.1 Take the per-channel snapshot when a socket closes, and before a connection's first socket opens, from `PUSHED` message rows of the last 24 hours, grouped by `source_channel_id`, with snowflakes compared as integers.
- [ ] 4.2 After a fresh IDENTIFY, read `GET /channels/{source_channel_id}/messages?after=<snapshot id>` for each channel through a new `DiscordAdapter.fetch_messages_after`, page forward, and pass each message through the shared path with origin `PUSHED`. Reuse the snapshot across retries. Skip recovery after a successful resume.
- [x] 4.3 Unit tests in `test_discord_recovery.py`: missed messages are stored and enqueued, a live message stored first does not hide an earlier missed one, duplicates are dropped, a resume skips recovery, quiet channels are skipped.

## 5. M3: setup screen in /m (PR 3, after 1.1 and 1.3 are merged)

- [ ] 5.1 Add `"discord"` to `ChannelPlatform` (`web/packages/agenta-settings-ui/src/channels/types.ts`) and `CHANNEL_PLATFORMS` (`helpers.ts`), the platform logo in `icons.tsx`, and the mapping in `actions.ts`.
- [ ] 5.2 Add the Discord branch of `ChannelConnectFlow.tsx`, modeled on the custom Telegram flow: create the bot and turn on the Message Content intent, paste the token, then show the invite link from the setup document.
- [ ] 5.3 Add the Discord rows to `summarizeConnection` in `helpers.ts`, reusing the Telegram states, and update the platforms label in `web/mobile/src/features/agents/AgentChannelsCard.tsx` and `useAgentChannels.ts`.
- [ ] 5.4 Get Mahmoud's approval for every new user-facing string (setup steps, errors, row subtitles, the platforms label) before merge.
- [ ] 5.5 Package unit tests and stories for the Discord connect flow, following `ChannelConnectFlow.stories.tsx`; run `pnpm lint-fix` in `web`.

## 6. Docs (keep-docs-in-sync, can start with M1)

- [ ] 6.1 Add `docs/docs/guides/15-connect-discord.mdx`: create the application and bot, turn on the Message Content intent, paste the token, invite the bot, and how the agent answers in DMs, mentions and threads. Follow the `write-docs` skill.
- [x] 6.2 Update `docs/design/channels-research/v2/channels.md` Discord section with the v1 declaration and the verified values in design.md.
- [x] 6.3 Update `docs/docs/self-host/concepts/01-architecture.mdx` (worker-queues and Channel Messages) to say that `worker-queues` also holds the Discord sockets when `channels-inbox` is selected.

## 7. Live QA (after M2, M3 and M4 are deployed together)

- [ ] 7.1 On a local stack, create a test Discord application and bot, connect it from the /m agent page, and check the intent refusal with the intent off.
- [ ] 7.2 Invite the bot with the shown link and check the granted permissions in the server.
- [ ] 7.3 DM the bot twice and check one session; mention it in a channel and check the thread, the typing indicator, the reaction and a long answer split at 2,000 characters.
- [ ] 7.4 Trigger a tool approval and click Approve, then click a stale button.
- [ ] 7.5 Run two `worker-queues` replicas, stop the lock holder, and check that the other takes over. Force a fresh IDENTIFY with messages posted during the gap and check that each starts one turn.
- [ ] 7.6 Record the run and post the evidence on the PR, following the `qa-loop` skill.
