# Agenta's hosted WhatsApp number: implementation plan

**Goal:** A user connects an agent to WhatsApp through Agenta's own number in under a minute: open the WhatsApp card, choose "Use Agenta's WhatsApp", scan the QR code, send the prefilled message, and the agent answers. The flow, data model and chat behavior match hosted Telegram.

**Architecture:** A `whatsapp_hosted` channel whose adapter subclasses PR #7132's `WhatsAppAdapter` and reads its number, token and app secret from the deployment env, the way `HostedTelegramAdapter` subclasses `TelegramAdapter`. The existing WhatsApp routes gain a hosted branch. The hosted Telegram bind service and tables become channel-agnostic and serve both hosted channels. A capability field adds a per-project daily cap that the outbox enforces. The connect card reuses the Telegram hosted steps.

**Tech stack:** Python 3 with FastAPI, Pydantic, SQLAlchemy and Alembic (API); httpx against the Graph API through the existing fake (`api/oss/tests/pytest/unit/channels/whatsapp/fake_graph.py`); React with Vitest (`@agenta/settings-ui`).

Read [design.md](design.md) first. The branch builds on `feat/whatsapp-channel` (PR #7132). Rebase on it, or on `main` once it merges, before starting.

| Phase | Scope | Tasks | Size |
| --- | --- | ---: | --- |
| 1 | Shared hosted bind service and migration | 3 | S-M, 1.5-2 days |
| 2 | Hosted adapter, config, code, ingress branch | 4 | M, 2-3 days |
| 3 | Catalog routes, daily cap, hosted template | 4 | M, 1.5-2 days |
| 4 | Connect card hosted tab | 2 | S-M, 1.5-2 days |
| 5 | Meta setup, docs, live QA | 3 | M, 2-3 days plus Meta review time |
| | **Total** | | **8.5-12 days** |

Phases 1 to 3 can ship as one API pull request or three. Phase 4 needs phase 3's routes. Phase 5 needs a real number in each deployment.

## Conventions used in every task

Commands run from the repository root unless a `cd` is shown.

- **API unit test:** `cd api && uv run --no-sync python run-tests.py <path>[::<test>]`. Run `uv sync --locked` once first.
- **API integration test** (needs the local Postgres; see `hosting/AGENTS.md`): `load-env hosting/docker-compose/oss/.env.oss.dev`, then `cd api && uv run --no-sync python run-tests.py <path>[::<test>]`.
- **Settings UI unit test:** `cd web/packages/agenta-settings-ui && pnpm vitest run <path>`.
- **Before each commit:** `cd api && ruff format && ruff check --fix` for API changes, and `cd web && pnpm lint-fix` for web changes. In a GitButler workspace, commit with `but commit <branch> -m "<message>"`. Otherwise use `git commit -m "<message>"`.
- Migration numbers assume `oss000000036_add_channel_delivery_held` is the head of `api/oss/databases/postgres/migrations/core_oss/versions/`. Take the next free number at implementation time.
- Hosted WhatsApp unit tests live next to the bring-your-own ones in `api/oss/tests/pytest/unit/channels/whatsapp/`, reuse `fake_graph.py` and `payloads.py`, and set the hosted env through `monkeypatch` on `env.channels.whatsapp.hosted`, as `test_telegram_hosted_env.py` does for Telegram.

Every task follows five steps: (1) write the failing test, (2) run it and see it fail, (3) implement, (4) run it and see it pass, (5) commit. When the run command is the same for steps 2 and 4, it is written once.

---

## Phase 1: A shared hosted bind

PR title: `refactor(api): make the hosted bind serve more than one channel`. No behavior change for Telegram.

### Task 1.1: Channel column on the bind tables

- Create: `api/oss/databases/postgres/migrations/core_oss/versions/oss000000037_add_hosted_bind_channel.py` (add `channel` `String NOT NULL server_default 'telegram_hosted'` to `channel_telegram_bind_tokens` and `channel_telegram_chat_bindings`; drop `uq_channel_telegram_chat_bindings_bot_chat`; create `uq_channel_hosted_chat_bindings_channel_bot_chat` on `(channel, bot_id, chat_id)`; the downgrade reverses both).
- Modify: `api/oss/src/dbs/postgres/channels/telegram_bind_dbas.py` (the `channel` column on both mixins), `telegram_bind_dbes.py` (the new unique constraint), `telegram_bind_dao.py` (write `channel` on save and bind; filter `get_binding` and `get_token` by channel).
- Test: create `api/oss/tests/pytest/integration/channels/test_channels_hosted_bind_dao.py`, using the `channels_scope` fixture from `integration/channels/conftest.py`.

1. Write `test_same_bot_and_chat_ids_bind_separately_per_channel` (a `telegram_hosted` and a `whatsapp_hosted` binding with the same `bot_id` and `chat_id` both exist and each lookup finds its own), `test_existing_rows_read_as_telegram_hosted` (a row inserted without `channel` reads back as `telegram_hosted`), and `test_token_lookup_is_scoped_to_its_channel`.
2. Run `load-env hosting/docker-compose/oss/.env.oss.dev`, then `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/integration/channels/test_channels_hosted_bind_dao.py`. It fails because the column is missing.
3. Add the migration, the columns and the DAO filters. Apply the migration with `bash ./hosting/docker-compose/run.sh --oss --dev --build`. `--recreate api` alone does not migrate.
4. Run the same command. It passes. Also run `oss/tests/pytest/unit/channels/telegram/test_telegram_bind_dao.py`.
5. Commit: `feat(api): key hosted chat bindings by channel`.

### Task 1.2: `HostedBindingService`

- Create: `api/oss/src/core/channels/hosted_binding.py` by moving `telegram_binding.py` and renaming `TelegramBindingService` to `HostedBindingService` and `TelegramBindingStore` to `HostedBindingStore`. The constructor takes `channel: str`, `capabilities`, `link: HostedBindLink`, and `ttl`. `HostedBindLink` is a small protocol with `mint_code() -> str` and `url(code) -> str`. Add `TelegramBindLink(bot_username)` that keeps `token_urlsafe(32)` and `https://t.me/<bot>?start=<token>`. `BindToken` gains `channel`. `consume_bind_token` raises `BindTokenInvalid` when the token's channel is not the service's channel.
- Modify: every importer of `telegram_binding` (`api/oss/src/apis/fastapi/channels/ingress.py`, `router.py`, `api/entrypoints/routers.py`, `telegram_bind_dao.py`). Delete `telegram_binding.py`; no re-export module.
- Test: rename `api/oss/tests/pytest/unit/channels/telegram/test_telegram_binding.py` to `api/oss/tests/pytest/unit/channels/test_channels_hosted_binding.py` and extend it.

1. Write `test_a_token_minted_for_one_channel_is_invalid_on_another` and `test_the_link_comes_from_the_channel_link_format` (a fake link format's URL is returned verbatim). Keep every existing Telegram case unchanged.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_hosted_binding.py`. It fails on import.
3. Move and rename. Update the importers.
4. Run the same command, then the whole `oss/tests/pytest/unit/channels/telegram/` folder and `oss/tests/pytest/unit/channels/test_channels_router.py`. All pass.
5. Commit: `refactor(api): one hosted bind service for every hosted channel`.

### Task 1.3: `ensure_hosted_connection(channel=...)`

- Modify: `api/oss/src/core/channels/service.py` (rename `ensure_hosted_telegram_connection` to `ensure_hosted_connection(*, channel, slug, name, project_id, user_id, references)`; the body is unchanged apart from the channel), `api/oss/src/apis/fastapi/channels/router.py` (the Telegram handler passes `channel="telegram_hosted", slug="agenta-telegram", name="Agenta on Telegram"`).
- Test: extend `api/oss/tests/pytest/unit/channels/test_channels_service_routing.py`.

1. Write `test_ensure_hosted_connection_keeps_one_connection_per_channel_per_project` (a Telegram and a WhatsApp hosted connection in one project are separate rows; a second call for either reuses its row) and `test_ensure_hosted_connection_retargets_the_default_agent`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_service_routing.py`. It fails on the missing method.
3. Rename and parameterize.
4. Run the same command and `oss/tests/pytest/unit/channels/test_channels_router.py`. Both pass.
5. Commit: `refactor(api): ensure a hosted connection for any hosted channel`.

---

## Phase 2: The hosted adapter and ingress

PR title: `feat(api): Agenta's hosted WhatsApp number`.

### Task 2.1: Overridable credentials in `WhatsAppAdapter`

- Modify: `api/oss/src/core/channels/adapters/whatsapp/adapter.py` (turn the module functions `_phone_number_id(connection)` and `_access_token(connection)` into methods `_number_id(connection)` and `_token(connection)`, and read the app secret through `_app_secret(connection)`; every call site uses the methods).
- Test: extend `api/oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_adapter.py`.

1. Write `test_a_subclass_can_supply_the_number_token_and_secret` (a test subclass returning fixed values sends through the fake Graph API with them and verifies a signature with its secret, with a connection whose data is empty).
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_adapter.py`. The new case fails.
3. Refactor.
4. Run the whole `oss/tests/pytest/unit/channels/whatsapp/` folder. All pass.
5. Commit: `refactor(api): let a WhatsApp adapter subclass supply its credentials`.

### Task 2.2: Config, capabilities and `HostedWhatsAppAdapter`

- Modify: `api/oss/src/utils/env.py` (add `ChannelsWhatsAppHostedConfig` under `ChannelsWhatsAppConfig.hosted` with `phone_number_id`, `access_token`, `app_secret`, `verify_token`, `display_number` read from the `WHATSAPP_HOSTED_*` variables, `daily_message_cap: int` from `WHATSAPP_HOSTED_DAILY_MESSAGE_CAP` defaulting to 100, and `enabled` true only when the first five are set), `api/oss/src/core/channels/dtos.py` (add `daily_message_cap: int = 0` to the conversation capability; 0 means no cap), `api/entrypoints/channel_adapters.py` (register `"whatsapp_hosted": HostedWhatsAppAdapter()`).
- Create: `api/oss/src/core/channels/adapters/whatsapp_hosted/__init__.py`, `capabilities.py` (a deep copy of `WHATSAPP_CAPABILITIES` with `channel = "whatsapp_hosted"`, identity `{"scope": "project", "stable": True, "keys": {"connection": ["project"], "space": ["wa_id"], "thread": ["wa_id"]}}`, empty setup, and `conversation.daily_message_cap` from env), `adapter.py` (`HostedWhatsAppAdapter(WhatsAppAdapter)`: `channel = "whatsapp_hosted"`; `hosted_setup_available()` returns `env.channels.whatsapp.hosted.enabled`; the three credential methods read env; `verify_connection` returns the display number and makes no Meta call; `activate_connection` is a no-op; `revoke_installation` returns `None`; `reopen_conversation` sends the template `agenta_reply_ready` in `en`).
- Test: create `api/oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_hosted_adapter.py`.

1. Write `test_hosted_is_available_only_with_all_five_settings`, `test_hosted_capabilities_key_on_the_project_and_the_customer`, `test_hosted_sends_with_the_deployment_token_and_number` (through the fake Graph API, with `connection=None`), `test_hosted_reopen_sends_agenta_reply_ready`, and `test_hosted_setup_has_no_fields`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_hosted_adapter.py`. It fails on import.
3. Implement.
4. Run the same command and `oss/tests/pytest/unit/channels/test_channel_adapter_registry.py`. Both pass.
5. Commit: `feat(api): add the whatsapp_hosted adapter and its deployment settings`.

### Task 2.3: The bind code and its message

- Modify: `api/oss/src/core/channels/adapters/whatsapp_hosted/adapter.py` (add `WhatsAppBindLink(display_number)`: `mint_code()` returns 12 Crockford base32 characters from `secrets`; `url(code)` returns `https://wa.me/<digits>?text=` plus the URL-encoded `Hi Agenta! Connect my WhatsApp. Code: XXXX-XXXX-XXXX`; and `extract_code(text) -> str | None`, which upper-cases, finds the first 12 code characters in three groups of four with optional dashes or spaces, and returns them without separators).
- Modify: `api/oss/src/dbs/postgres/channels/telegram_bind_dao.py` only if the code needs normalizing on save (store it without separators).
- Test: create `api/oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_hosted_code.py`.

1. Write `test_code_is_twelve_crockford_characters`, `test_link_opens_a_chat_with_the_prefilled_message` (decode the `text` parameter and compare), `test_extract_finds_the_code_in_the_unedited_message`, `test_extract_ignores_case_dashes_and_spaces`, `test_extract_survives_edited_words`, and `test_extract_returns_none_for_plain_text`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_hosted_code.py`. It fails on import.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): a friendly one-time code for the hosted WhatsApp link`.

### Task 2.4: The hosted branch in the WhatsApp ingress

- Modify: `api/oss/src/apis/fastapi/channels/ingress.py`:
  - `verify_whatsapp_webhook`: when hosted is enabled and `hub.verify_token` equals `env.channels.whatsapp.hosted.verify_token` (constant-time compare), echo the challenge before the per-connection lookup.
  - `ingest_whatsapp_event`: for each phone number ID in the body, call `_ingest_whatsapp_hosted` when it equals the hosted phone number ID and hosted is enabled; otherwise keep the bring-your-own path.
  - `_ingest_whatsapp_hosted`: verify `X-Hub-Signature-256` with the hosted app secret through `mapping.verify_signature` before reading anything; parse with `mapping.parse_events(body=..., phone_number_id=<hosted id>)`; for each event, extract a code. A code on an unbound phone, or a code that exists as a token, goes to `consume_bind_token` with Telegram's refusal replies (the "bound elsewhere" text says "WhatsApp number"). Otherwise resolve the binding; an unbound phone is ignored; a bound phone's event is recorded with `_record_and_enqueue` on the bound project and connection.
  - Replies during bind go through `HostedWhatsAppAdapter.post_message(connection=None, locator={"wa_id": ...})`, best-effort like `_hosted_say`.
- Modify: `api/entrypoints/routers.py` (build a second `HostedBindingService(channel="whatsapp_hosted", link=WhatsAppBindLink(...), capabilities=fetch_whatsapp_hosted_capabilities())` when hosted WhatsApp is enabled, and pass it to the ingress and the channels router).
- Test: create `api/oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_hosted_ingress.py`, following the client and fixtures of `test_whatsapp_ingress.py`.

1. Write:
   - `test_handshake_with_the_hosted_verify_token_echoes_the_challenge`
   - `test_hosted_event_with_a_bad_signature_is_401_and_binds_nothing`
   - `test_prefilled_message_binds_the_phone_and_greets`
   - `test_edited_code_gets_the_not_valid_reply_and_writes_nothing`
   - `test_expired_code_gets_the_not_valid_reply`
   - `test_redelivered_bind_message_is_idempotent`
   - `test_phone_bound_elsewhere_gets_the_disconnect_first_reply`
   - `test_bound_phone_is_routed_to_its_project`
   - `test_bound_phone_sending_an_unknown_code_shape_is_routed_as_a_message`
   - `test_unbound_phone_saying_hello_gets_nothing_and_stores_nothing`
   - `test_byo_number_on_the_same_route_is_unchanged`
   - `test_hosted_disabled_refuses_hosted_events`
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_hosted_ingress.py`. It fails.
3. Implement.
4. Run the same command, `oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_ingress.py`, and `oss/tests/pytest/unit/channels/test_channels_ingress_public_endpoints.py`. All pass.
5. Commit: `feat(api): bind and route phones on Agenta's WhatsApp number`.

---

## Phase 3: Routes, the daily cap and the template

### Task 3.1: Catalog routes

- Modify: `api/oss/src/apis/fastapi/channels/models.py` (`WhatsAppHostedBindLinkRequest`, `WhatsAppHostedBindLinkResponse`, `WhatsAppHostedBinding`, `WhatsAppHostedBindingsResponse`, the same fields as the Telegram models), `api/oss/src/apis/fastapi/channels/router.py` (`POST /catalog/channels/whatsapp_hosted/bind-link/` and `GET /catalog/channels/whatsapp_hosted/bindings/`, sharing one private helper with the Telegram handlers; 404 "The hosted WhatsApp number is not configured on this deployment." when the service is absent; disconnect releases bindings through every configured hosted service).
- Test: extend `api/oss/tests/pytest/unit/channels/test_channels_router.py` and `api/oss/tests/pytest/acceptance/channels/test_channels_permissions.py`.

1. Write `test_whatsapp_hosted_bind_link_requires_edit_channels`, `test_whatsapp_hosted_bind_link_is_404_without_the_number`, `test_whatsapp_hosted_bind_link_returns_a_wa_me_link`, `test_whatsapp_hosted_bindings_are_project_scoped`, and `test_disconnect_frees_whatsapp_hosted_bindings`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/test_channels_router.py`. It fails.
3. Implement.
4. Run the same command. It passes.
5. Commit: `feat(api): hosted WhatsApp bind-link and bindings routes`.

### Task 3.2: The daily cap

- Modify: `api/oss/src/tasks/asyncio/channels/outbox.py` (in `_deliver`, next to the reply-window check: when `capabilities.conversation.daily_message_cap > 0`, count the connection's sent rows in the last 24 hours; at the cap, send the fixed notice as its own outbox row and mark the reply failed with `daily_cap`; above it, mark failed with `daily_cap` and send nothing), `api/oss/src/dbs/postgres/channels/dao.py` and `api/oss/src/core/channels/interfaces.py` (`count_sent_outbox_events(project_id, connection_id, since)`).
- Test: extend `api/oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_outbox.py` and `api/oss/tests/pytest/integration/channels/test_channels_dao_outbox.py`.

1. Write `test_under_the_cap_sends`, `test_at_the_cap_sends_the_notice_once_and_fails_the_reply`, `test_past_the_cap_sends_nothing`, `test_split_parts_and_templates_count`, `test_byo_whatsapp_has_no_cap`, and, in the DAO file, `test_count_sent_outbox_events_counts_only_sent_rows_in_the_window`.
2. Run `cd api && uv run --no-sync python run-tests.py oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_outbox.py`. The new cases fail.
3. Implement.
4. Run the same command, the DAO integration file, and `oss/tests/pytest/unit/channels/test_channels_outbox_worker.py`. All pass.
5. Commit: `feat(api): a per-project daily message cap on the hosted WhatsApp number`.

### Task 3.3: The hosted re-open template

Already covered by `reopen_conversation` in task 2.2. Add the outbox-level case here.

- Test: extend `api/oss/tests/pytest/unit/channels/whatsapp/test_whatsapp_outbox.py`.

1. Write `test_hosted_held_reply_sends_agenta_reply_ready_once`.
2. Run the outbox test file. It fails if the hosted connection path skips the template.
3. Fix any wiring.
4. Run it again. It passes.
5. Commit: `test(api): hosted WhatsApp re-opens with Agenta's template`.

### Task 3.4: Fern client

1. Regenerate the Fern client from an EE OpenAPI spec, following the `reference_fern_client_regeneration` procedure. The new request and response types appear under `web/packages/agenta-api-client/src/generated/`.
2. Run `cd web && pnpm lint-fix`.
3. Commit: `chore(web): regenerate the API client for hosted WhatsApp`.

---

## Phase 4: The connect card

### Task 4.1: Actions

- Modify: `web/packages/agenta-settings-ui/src/channels/actions.ts` (`connectHostedWhatsApp()` and `countHostedWhatsAppBindings(connectionId)`, mirroring the Telegram pair), `types.ts` (`HostedWhatsAppLink`, or reuse `HostedTelegramLink` renamed to `HostedLink`), `helpers.ts` (the no-op defaults).
- Test: extend `web/packages/agenta-settings-ui/tests/unit/channelsActions.test.ts`.

1. Write `connectHostedWhatsApp posts to the whatsapp_hosted bind-link route` and `countHostedWhatsAppBindings reads the bindings count`.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelsActions.test.ts`. It fails.
3. Implement.
4. Run it again. It passes.
5. Commit: `feat(frontend): hosted WhatsApp connect actions`.

### Task 4.2: The hosted tab

- Modify: `web/packages/agenta-settings-ui/src/channels/ChannelConnectFlow.tsx` (the WhatsApp card gets the "Agenta's WhatsApp" and "Your own number" switch when `hostedAvailable`; generalize the Telegram hosted state to a hosted-link state used by both platforms; WhatsApp strings from design D13, including the daily limit line), `ChannelConnectFlow.stories.tsx` (a hosted WhatsApp story), `storyFixtures.tsx`.
- Test: extend `web/packages/agenta-settings-ui/tests/unit/channelWhatsApp.test.tsx`.

1. Write `opens on Agenta's WhatsApp when the hosted number is available`, `shows the QR code, the Open WhatsApp button and the daily limit`, `moves to Connected when a binding appears`, `shows expired after the link lifetime and mints a new link`, and `opens on the paste form when the hosted number is not available`. Keep the existing bring-your-own cases.
2. Run `cd web/packages/agenta-settings-ui && pnpm vitest run tests/unit/channelWhatsApp.test.tsx tests/unit/channelConnectFlow.test.tsx`. The new cases fail.
3. Implement.
4. Run the same command. All pass.
5. Commit: `feat(frontend): use Agenta's WhatsApp from the connect card`.

---

## Phase 5: Meta setup, docs and live QA

### Task 5.1: Meta setup per deployment (ops, no code)

For each of EU, US and staging: register the number in Agenta's WhatsApp Business Account (staging in a separate test app), request the display name "Agenta", set the profile description "This is Agenta's WhatsApp. Connect it from your agent at agenta.ai." and the Agenta mark, submit the `agenta_reply_ready` utility template in `en`, set the phone-number callback override to `<AGENTA_API_URL>/channels/whatsapp/events/` with the hosted verify token, subscribe the app to `messages`, create a system-user token, and set the `WHATSAPP_HOSTED_*` variables on `api`, `worker-queues` and `worker-streams`. Record the steps in the local ops note next to hosted Slack and Telegram (not in the public repo).

### Task 5.2: Docs

- Modify: `docs/docs/guides/11-connect-whatsapp.mdx` (a "Use Agenta's WhatsApp" section before the bring-your-own steps, with the daily limit).
- Create: `docs/docs/self-host/channels/02-whatsapp-hosted-number.mdx` (the variables and the Meta setup, mirroring `01-telegram-hosted-bot.mdx`).
- Modify: `docs/docs/self-host/reference/01-configuration.mdx` (the six variables).
- Commit: `docs: Agenta's hosted WhatsApp number`.

### Task 5.3: Live QA through the UI

Run on the EE dev stack exposed on HTTPS (`load-env hosting/docker-compose/ee/.env.ee.dev` and `bash ./hosting/docker-compose/run.sh --ee --dev --build`), with the staging number's callback override pointing at that stack. The hosted variables are set once by the operator before QA. During QA, change no config, env or database row. Record an MP4 of the browser and a screen recording of the phone, and keep evidence under `~/`, not `/tmp`.

1. Create a fresh agent in the UI with a simple prompt ("You are a helpful assistant. Answer in one sentence.").
2. Open the agent's channels, click the WhatsApp card. It opens on "Agenta's WhatsApp" and shows a QR code, an "Open WhatsApp" button, and the daily limit line.
3. Scan the QR code with a phone. WhatsApp opens a chat with "Agenta" and the prefilled message. Tap Send without editing.
4. The phone gets "You are connected. Send a message and your agent will reply." The card flips to Connected with no click.
5. Send "What is 2 + 2?". The typing indicator shows, then the agent answers in one sentence. The session appears in Agenta.
6. Mint a new link, edit one character of the code on the phone, and send it from a second phone. It gets "That connection link is not valid anymore...". Nothing binds.
7. From a phone that never bound, send "hello". Nothing comes back.
8. Create a second project with an agent and scan its link from the first phone. It gets "connected to another Agenta project". Disconnect WhatsApp in the first project, scan again, and the phone binds to the second project's agent.
9. In the second project, connect a different agent from its card. The phone's next message reaches the new agent without scanning again.
10. Send STOP, then a question: no answer. Send START, then a question: the agent answers.
11. Open Settings > Channels outbound events. The QA messages are listed as sent. The daily cap needs a config change to reach quickly, so the UI run does not test it; task 3.2's tests cover it.
12. On the Railway preview or staging (production-like), repeat steps 1 to 5 once.

## Risks

- **Meta review time** for business verification, display names and the template can take days to weeks and blocks phase 5 in production. Start task 5.1 on day one.
- **The phone-number webhook override** is documented but untested here. If it misbehaves, fall back to one Meta app per region (design D10).
- **Shared quality rating.** Watch the number's quality in Meta Business Manager for the first weeks.
- **PR #7132 is not merged.** Rebase this work when it lands. Migration numbers can collide; renumber at implementation time.
- **The "already connected" wait quirk** is shared with Telegram and not fixed here.
