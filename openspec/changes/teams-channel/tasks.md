# Tasks

Status: not started. The tasks follow the three pull requests in the design. PR 1 targets `main`. PR 2 and PR 3 both target the PR 1 branch and run in parallel, once the PR 1 contract (capability declaration, locator fields, setup document) is final in this spec. Live QA runs last, on one stack with all three PRs.

The Discord PRs touch the same lists (the adapter registry, the secret kinds, the platform list in the setup screen). If they merge first, rebase the Teams PRs on `main`; the conflicts are small additions to the same lists.

## 0. Before M3 copy is final

- [ ] 0.1 Day-one reply test: register a bot in the Teams Developer Portal (Tools, then Bot management) in the test tenant, with no Azure subscription. Get an access token with the client credentials request, then send one reply to a personal chat through `POST {serviceUrl}/v3/conversations/{id}/activities`. Record the result in this change. If the reply fails, switch the setup guide to the Azure portal (D2) before M3 writes its copy.

## 1. M1 Adapter and inbound (PR 1, base main)

- [ ] 1.1 Add `pyjwt[crypto]` as a direct dependency in `api/pyproject.toml` at the version already in `api/uv.lock`, and update the lock.
- [ ] 1.2 Add `ChannelSecretKind.TEAMS = "teams"` to `api/oss/src/core/secrets/enums.py` and the field `client_secret` to `ChannelSecretSettingsDTO` in `api/oss/src/core/secrets/dtos.py`.
- [ ] 1.3 Add `api/oss/src/core/channels/adapters/teams/capabilities.py` with the declaration in design.md: setup fields `app_id`, `client_secret`, `tenant_id` with their labels, help text and GUID pattern error; identity keys `app_id` / `tenant_id, conversation_id` / `tenant_id, conversation_id, thread_id`; `indicator: "native"`, `update: false`, `max_chars` 20000; no files; no backfill.
- [ ] 1.4 Add `teams/mapping.py`: the helper that turns `28:<app_id>`, `api://<app_id>` and `api://botid-<app_id>` into the bare `app_id`; the pair of helpers that split `conversation.id` into `conversation_id` and `thread_id` and join them back; the `conversationType` to space kind map; mention detection from `entities` and removal of the bot's own mention text; the choice token read from `value.choice_token`; the sender from `from.aadObjectId` (ignore an activity without it); and the locator builder.
- [ ] 1.5 Add `teams/signature.py`: the inbound JWT check (RS256, issuer, the three audience forms, 300 s leeway, `serviceurl` claim) with a deployment-wide key cache from the Bot Framework OpenID document, refreshed after 24 hours or on an unknown key id.
- [ ] 1.5b Make the per-connection setup route pass `ChannelSetupIdentity(name=<connection name>)` to `build_setup_document` (`api/oss/src/apis/fastapi/channels/router.py:1068-1072`), with a unit test.
- [ ] 1.6 Add `teams/package.py` and the two icons (`color.png` 192 by 192, `outline.png` 32 by 32): `manifest.json` with the UUIDv5 id of `app_id` under a fixed namespace, the constant version, `name.short` (30 characters) and `description.short` (80 characters) from `identity` with the defaults "Agenta" and "An Agenta agent.", `developer.name` "Agenta" and the three developer URLs from `env.agenta.web_url`, `bots[0].botId`, the three scopes, and no RSC; the zip in memory with `zipfile`; the base64 `content`.
- [ ] 1.7 Add `teams/adapter.py` with `TeamsAdapter`: `fetch_capabilities`, `verify_connection` (token request and the four quoted error messages, returns `app_id`, `tenant_id`, `webhook_url`), `build_setup_document` (`format: "zip"`, `None` without an `app_id`), `connection_locator`, `verify_signature`, `parse_event` (tenant check, messages, card clicks, ignored activities), `detect_deactivation` returning false, `discover_spaces` returning nothing. Outbound methods raise `NotImplementedError` until M2.
- [ ] 1.8 State in the `ChannelSetupDoc` docstring (`api/oss/src/core/channels/dtos.py`) that a `zip` document carries base64 content.
- [ ] 1.9 Register `"teams": TeamsAdapter()` in `api/entrypoints/channel_adapters.py`.
- [ ] 1.10 Add the route `POST /teams/events/` in `api/oss/src/apis/fastapi/channels/ingress.py`, calling `_ingest`, and the four `_PUBLIC_ENDPOINTS` entries in `api/oss/src/middlewares/auth.py`.
- [ ] 1.11 Unit tests under `api/oss/tests/pytest/unit/channels/teams/`: `fake_teams.py` (a fake Bot Framework key endpoint and Microsoft token service served through `httpx.ASGITransport`, and signed test JWTs made with an RSA key generated in the test), `payloads.py`, `test_teams_capabilities.py` (normalisation, key composition with `thread_id` `""`), `test_teams_mapping.py` (id forms, conversation id split and join, space kinds, mentions, command after a mention, choice token), `test_teams_signature.py` (each JWT check, key refresh on an unknown key id), `test_teams_adapter.py` (token check and each error message, package content and stable manifest id, tenant check, ignored activities, `external_id` is the activity id), and a route test next to `test_channels_ingress_public_endpoints.py`.
- [ ] 1.12 Add `teams/test_teams_contract_suite.py` that runs `run_contract_suite` from `api/oss/tests/pytest/unit/channels/contract/test_channel_adapter_contract.py` with a Teams connection, and turns the suite's generic good or bad signature signal into a real signed test JWT, as `slack/test_slack_contract_suite.py` does.
- [ ] 1.13 Run `~/.local/bin/ruff format` then `~/.local/bin/ruff check --fix` in `api` (never `uvx ruff`), then `cd api && py-run-tests`.

## 2. M2 Delivery and approvals (PR 2, base PR 1 branch)

Runs in parallel with group 3.

- [ ] 2.1 Add the access token cache per connection in `teams/adapter.py`: one token request per connection, reused until 5 minutes before expiry, behind a lock per connection, with a size cap.
- [ ] 2.2 Add the reply host allowlist check before every outbound request.
- [ ] 2.3 Set `channelData.tenant.id` to the connection's `tenant_id` on every outbound activity.
- [ ] 2.4 Implement `post_message`: the reply conversation from `conversation_id` and `thread_id`, Markdown text, the receipt with the returned activity id, and `ChannelDeliveryUncertain` after a partial post.
- [ ] 2.5 Implement the approval card in `teams/mapping.py` (Adaptive Card with `Action.Submit` buttons that carry the choice token) and `dismiss_choices` (PUT of the same card without actions).
- [ ] 2.6 Implement `signal_activity` with a `typing` activity.
- [ ] 2.7 Implement the error mapping: a private `_TeamsApiError` with `status_code`, one token refresh and retry on 401, then `ChannelCredentialRevoked`; `ChannelCredentialRevoked` also when the token request is refused for the secret.
- [ ] 2.8 Unit tests: extend `fake_teams.py` with a fake Bot Framework connector service; add `test_teams_delivery.py` (token reuse and refresh, host allowlist, tenant on every send, thread and chat replies, typing, card and dismiss, 401 refresh, 403 `MessageWritesBlocked`, 429, 5xx), `test_teams_outbox.py` (the native indicator and the working message after 30 seconds, long answer split at 20,000 characters), and `test_teams_approval_routing.py` (a click resolves the pending choice, a stale click starts no turn).
- [ ] 2.9 Run `~/.local/bin/ruff format` then `~/.local/bin/ruff check --fix` in `api`, then `cd api && py-run-tests`.

## 3. M3 Setup screen in /m and docs (PR 3, base PR 1 branch)

Runs in parallel with group 2.

- [ ] 3.1 Add `"teams"` to `ChannelPlatform` (`web/packages/agenta-settings-ui/src/channels/types.ts`) and `CHANNEL_PLATFORMS` (`helpers.ts`), a Teams logo in `icons.tsx`, and the mapping in `actions.ts`.
- [ ] 3.2 Add a small `fetchChannelConnectionSetup` wrapper to `ChannelsActions` in `actions.ts`, in the same shape as the Discord setup branch, on top of the generated client call that main already has (`web/packages/agenta-api-client/src/generated/api/resources/channels/client/Client.ts`). If the Discord setup PR merges first, merging main keeps one copy. Keep `format` and `filename` of the setup document, and add one helper that decodes a `zip` document into a download.
- [ ] 3.3 Add the Teams branch of `ChannelConnectFlow.tsx`: the setup steps, the three fields, then after connect the "Messaging endpoint" copy field (reuse `CopyField` from `WhatsAppWebhook.tsx`), the "Download Teams app" button and the install steps. Load the package from the per-connection setup call.
- [ ] 3.4 Add the Teams rows to the connection states in `helpers.ts`, and update the platform lists and labels in `web/mobile` (`src/lib/sharingCopy.ts`, `src/features/agents/useAgentChannels.ts`, `src/features/chat/useAgentPrivacyProps.ts`, `src/features/agents/AgentChannelsCard.tsx`).
- [ ] 3.5 Write the setup instructions in `teams/capabilities.py` after task 0.1. Quote every new user-facing string in the PR description.
- [ ] 3.6 Package unit tests (`web/packages/agenta-settings-ui/tests/unit/channelTeams.test.tsx`: fields, endpoint copy, download decode) and stories next to `ChannelConnectFlow.stories.tsx`. Run `pnpm lint-fix` in `web`.
- [ ] 3.7 Add `docs/docs/guides/16-connect-microsoft-teams.mdx`: register the bot, copy the three values, paste the messaging endpoint, download and upload the app, how the agent answers in personal chats, group chats and channel threads, and the custom app upload setting. Link the Azure portal steps. Follow the `write-docs` skill.

## 4. Live QA (all PRs on one stack)

- [ ] 4.1 Deploy PR 1, PR 2 and PR 3 together on one local stack, with the messaging endpoint reachable by Microsoft.
- [ ] 4.2 Connect the test bot from the /m agent page. Check each setup error with a wrong secret, a wrong app id and a wrong tenant id.
- [ ] 4.3 Download the package, upload it in Teams, and upload it again to check that Teams updates the same app.
- [ ] 4.4 In a personal chat, send two messages and check one session, the typing signal, and the working message on a turn longer than 30 seconds.
- [ ] 4.5 In a team channel, mention the bot in a new post and check the reply in its thread; send a follow-up in the thread with a mention and without one; send `!new` after a mention.
- [ ] 4.6 In a group chat, mention the bot and check the reply.
- [ ] 4.7 Trigger a tool approval, click Approve, check that the buttons go away, then click a stale card.
- [ ] 4.8 Ask for a long answer and check the split. Remove the app from one chat and check that the bot still answers elsewhere.
- [ ] 4.9 Record the run and post the evidence on the PRs, following the `qa-loop` skill.
