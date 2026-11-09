# Design

Status: Proposal, not built. The design source is the reviewed Microsoft Teams channel design of 2026-11-09 (simplify and naming lenses both rated Low). The code facts below were read on `main` at `ce68eea1af`. The Microsoft facts were read from Microsoft Learn and from Microsoft's Python Teams SDK on 2026-11-09.

Terms used in this document:

- **connection**: one row in the channels connections table, which is one Teams bot set up in one project.
- **tenant**: one organization's Microsoft 365 account, with its own users and admins. Its id is a GUID, which Microsoft calls the directory (tenant) id.
- **bot registration**: the Microsoft record that gives a bot an application (client) id and a client secret, and holds the messaging endpoint. It is an app registration in Microsoft Entra, Microsoft's identity service.
- **messaging endpoint**: the HTTPS URL where Teams sends events for the bot. For Agenta it is the route `POST /channels/teams/events/`.
- **activity**: one JSON event from Teams, for example a message, a card click or an install event. Each activity has an `id` and a `serviceUrl`, which is the regional address that replies go to.
- **Teams app package**: a zip file with a `manifest.json` and two icons. A user uploads it to Teams to install the bot. The bot is not in the Teams store, so this upload is how every user installs it.
- **Adaptive Card**: Microsoft's JSON format for rich messages with buttons. **Action.Submit** is the button type this design uses.
- **inbound JWT**: the signed token (JSON Web Token) that Teams sends in the `Authorization` header of each request.
- **access token**: the short-lived token the adapter gets from Microsoft to send replies.
- **choice token**: the value an approval button carries, `<interaction UUID>:approve` or `<interaction UUID>:deny`.
- **RSC** (resource-specific consent): a Teams app permission, granted by a team or chat owner at install, that lets the bot receive every message in that team or chat.

## Context

### How Channels works today

Every platform is one adapter behind `ChannelAdapterInterface` (`api/oss/src/core/channels/adapters/interface.py:20`). The class attribute `channel` is the registry key (`interface.py:24`). The registry lists the first-party adapters in one place (`api/entrypoints/channel_adapters.py:54-70`). An adapter folder holds `adapter.py`, `capabilities.py` and `mapping.py`, as WhatsApp does (`api/oss/src/core/channels/adapters/whatsapp/`).

The HTTP ingress has one literal route per platform: `/slack/events/`, `/telegram/events/{routing_token}/` and `/whatsapp/events/`, each answering `202` (`api/oss/src/apis/fastapi/channels/ingress.py:153-191`). The router is mounted under `/channels` and `/preview/channels` (`api/entrypoints/routers.py:2160`, `:2166`). Each ingress path is also listed in `_PUBLIC_ENDPOINTS`, in four forms (`api/oss/src/middlewares/auth.py:146-163`).

The shared body `_ingest` (`ingress.py:660-746`) does these steps:

1. It resolves a candidate connection from the adapter's unverified `connection_locator` (`ingress.py:613-658`, called at `:691`). No match is refused as a bad signature (`ingress.py:702`).
2. It calls `verify_signature` (`ingress.py:708`), and `_connection_owns_identity` checks that the returned id is a value in the stored `data["connection_locator"]` (`ingress.py:718`, `:1075-1089`).
3. It calls `detect_deactivation`, then `parse_event`, then `_record_and_enqueue` once per event (`ingress.py:724-746`).
4. It answers `ChannelEventAck(status="accepted")` (`ingress.py:746`). `ChannelSignatureInvalid` becomes 401 (`ingress.py:98-121`).

`_record_and_enqueue` stores the inbox row and enqueues `channels.inbox.dispatch` under a 5 second timeout (`ingress.py:880-919`, timeout at `ingress.py:83`). It enqueues even when the row already existed, so a platform retry recovers from an earlier enqueue failure. The answer body is always the fixed `ChannelEventAck`; no adapter can choose a custom response body.

Duplicates are dropped in the database by the unique constraint `uq_channel_inbox_connection_external` over `(project_id, connection_id, external_id)` (`api/oss/src/dbs/postgres/channels/dbes.py:165-171`).

### Identity, threads and triggers

`create_connection` checks the setup field patterns (`api/oss/src/core/channels/service.py:199`, `_check_setup_field_patterns` at `service.py:2983`), calls `verify_connection`, and derives the stored `external_key` from what it returns (`service.py:177`). A non-secret setup field is stored in `data`; a secret field goes to the vault and is merged back into `connection.data` at runtime by `_hydrate_connection` (`service.py:706`).

A private space keys its thread on the space (`service.py:2408`). In a shared space a message starts a turn only when it is addressed: a mention, a command, or an answer to a pending choice (`_is_trigger`, `service.py:3235-3270`). A private space is always a trigger (`service.py:3254`). This rule shipped in the `channels-mention-only-threads` change.

The command grammar allows a leading mention before a command only in the forms `<@...>` or `@name` (`api/oss/src/core/channels/commands.py:35`).

### Approvals, typing and errors

The outbox rewrites each approval button value to the choice token `"{interaction_id}:{option}"` (`api/oss/src/tasks/asyncio/channels/outbox.py:770`). A click goes through `resolve_pending_choice`, which requires an exact token match for a click (`service.py:3188`).

A capability can declare `rendering.controls.indicator` as `"message"` or `"native"` (`api/oss/src/core/channels/dtos.py:192`). With `"native"`, the outbox posts no "Thinking…" message (`outbox.py:234`). It calls `signal_activity` every 20 seconds and posts one working message after 30 seconds (`outbox.py:87-88`, `:371-379`). The working message text is "Working on it, I'll reply here when I'm done." (`api/oss/src/core/channels/render/render.py:30`).

Core splits an answer at the declared `max_chars` before any adapter sees it (`_split_text`, `render.py:322`). It breaks at a paragraph, line or word boundary, and a code fence cut in half is closed and reopened in the next chunk.

The outbox classifies send errors with two shared rules (`api/oss/src/core/channels/utils.py:224-254`). `delivery_refused` is true for a 4xx other than 429; such a send is recorded as failed and not retried. `delivery_outcome_unknown` is true for a read timeout, a dropped connection or a 5xx; a post that may have landed is recorded as failed and not retried, to avoid a double post. A 429 and a connect error are retried. `ChannelCredentialRevoked` switches the connection off (`outbox.py:1127-1145`).

### Secrets and setup documents

`ChannelSecretKind` has the members `slack`, `telegram`, `whatsapp`, `agenta` and `bridge` (`api/oss/src/core/secrets/enums.py:99-104`). The service maps a channel key to it with `ChannelSecretKind(channel)` (`service.py:1221-1227`). `ChannelSecretSettingsDTO` is a fixed field list, `bot_token`, `signing_secret`, `webhook_secret`, `access_token` and `app_secret`, and unknown keys are dropped silently (`api/oss/src/core/secrets/dtos.py:257-274`).

`build_setup_document` receives the request URL, an optional identity and the stored `connection_locator`, never the connection, so a document cannot reach the credentials (`interface.py:38-56`). `get_connection_setup` passes the locator from `data["connection_locator"]` (`service.py:1158-1191`). `ChannelSetupDoc` has `format`, `content`, `filename` and `link` (`dtos.py:252-259`). The /m setup screen reads only `document.content` today, as `manifest` (`web/packages/agenta-settings-ui/src/channels/actions.ts:814`).

WhatsApp computes its callback URL in `verify_connection` and stores it as `data.webhook_url` (`api/oss/src/core/channels/adapters/whatsapp/adapter.py:148`). The setup screen reads it as `webhookUrl` (`actions.ts:235`) and shows it with a copy button (`web/packages/agenta-settings-ui/src/channels/WhatsAppWebhook.tsx`). The platform list is `["slack", "telegram", "whatsapp"]` (`web/packages/agenta-settings-ui/src/channels/helpers.ts:16`, type at `types.ts:9`).

### Libraries

`httpx` is a direct dependency (`api/pyproject.toml:21`), and so is `cryptography` (`api/pyproject.toml:25`). PyJWT 2.15.1 is in `api/uv.lock` only through other packages, and the API already imports it (`api/oss/src/middlewares/auth.py:14`). It is not listed in `api/pyproject.toml`.

### Teams facts this design relies on

| Fact | Value | Source |
| --- | --- | --- |
| Transport | Teams POSTs every activity to the one messaging endpoint. There is no socket or polling for bots. | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability |
| Retry of slow requests | "If an agent activity takes more than 15 seconds to process, Teams sends a retry request." No retry is documented for an endpoint that is down. | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/bot-concepts |
| Inbound JWT | RS256, keys from `https://login.botframework.com/v1/.well-known/openidconfiguration` (refresh at least every 24 hours), issuer `https://api.botframework.com`, audience the app id, 5 minutes of clock skew, and the `serviceurl` claim equal to the activity's `serviceUrl`. Microsoft's Python SDK accepts the audiences `<app_id>`, `api://<app_id>` and `api://botid-<app_id>`. | https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication |
| Access token | `POST https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token` with `grant_type=client_credentials` and scope `https://api.botframework.com/.default`. It lasts about 3600 seconds. Single-tenant bots use the tenant URL. | same page |
| Single tenant | "Multi-tenant bot creation will be deprecated after July 31, 2025." | https://learn.microsoft.com/azure/bot-service/abs-quickstart |
| Send and update | Send: `POST {serviceUrl}/v3/conversations/{conversationId}/activities`. Update: `PUT {serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}`. | https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-send-and-receive-messages, https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages |
| Reply hosts | Public `smba.trafficmanager.net`; government `smba.infra.gcc.teams.microsoft.com`, `smba.infra.gov.teams.microsoft.us`, `smba.infra.dod.teams.microsoft.us`. | send-proactive-messages page above |
| Removed app | A send after the app was removed or blocked gets 403 with `subCode: MessageWritesBlocked`. | send-proactive-messages page above |
| Conversation ids | Personal chat `a:...`, group chat `19:...@thread.v2`, team channel `19:...@thread.tacv2`. A message in a channel thread arrives with `19:...@thread.tacv2;messageid=<root id>`. A top-level post's activity `id` is the root id of its thread. | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/channel-and-group-conversations |
| Mentions | In group chats and channels a bot receives only messages that mention it, unless the app has RSC. The text holds `<at>Name</at>`, and `entities` holds `{type: "mention", mentioned: {id, name}, text}`. Bots cannot post in private channels and never receive other bots' messages. | channel-and-group-conversations page above, https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/enable-receive-all-chat-messages |
| Submit buttons | An `Action.Submit` click arrives as a `message` activity with a `value`, and its `replyToId` is the card's activity id. "It is not possible for your Bot to return a new card when processing an `Action.Submit`." The card is updated with a PUT. | https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/universal-action-model |
| Message size | "The agent message size limit is 100 KB", and Microsoft advises staying within 80 KB. | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/format-your-bot-messages |
| Rate limits | About 7 sends per second per conversation, 50 requests per second per app per tenant. | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/rate-limit |
| Install and uninstall events | `installationUpdate` with `action` `add` or `remove`, and `conversationUpdate` with `membersAdded`. | https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/subscribe-to-conversation-events |
| Custom app upload | An admin turns on "Upload custom apps"; "It can take up to 24 hours for the custom app upload to be active." | https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/prepare-your-o365-tenant |
| Bot without an Azure subscription | A Teams-managed bot is registered through the Teams Developer Portal and needs no Azure subscription. | https://microsoft.github.io/teams-sdk/cli/concepts/bot-locations |

## Goals / Non-Goals

**Goals:** Let a company talk to an Agenta agent in Teams personal chats, group chats and team channels. Reuse the adapter interface, ingress, inbox, outbox, approvals, grants and roster unchanged. Add no new service, no new environment variable and no new deployment setting. Keep the other channels exactly as they are.

**Non-Goals:** No hosted Agenta Teams bot. No files or images in or out. No history reads through Microsoft Graph. No message edits, deletes or reactions. No native slash commands; commands use the in-chat `!` sign. No streaming answers. No `Action.Execute` buttons and no custom HTTP response body.

## Decisions

### D1. The user brings their own bot

Microsoft no longer allows new multi-tenant bots, so each organization needs its own bot. OpenClaw, Hermes Agent and n8n all work this way.

| Option | Trade-off |
| --- | --- |
| **The user registers a bot and enters the app id, client secret and tenant id** | Works on every deployment, self-hosted included. Setup takes about ten minutes. |
| One Agenta-hosted Teams bot | Needs a multi-tenant bot, which Microsoft no longer allows for new bots, or the Teams store process. Not possible for v1. |

### D2. Where the user registers the bot (open question)

| Option | Trade-off |
| --- | --- |
| **Teams Developer Portal (Tools, then Bot management), with the Azure portal steps linked in the docs** | No Azure subscription and fewer steps. One public forum thread reports that a bot registered only there could not send replies. Task 0.1 tests this before the setup copy is final. |
| Azure portal | Microsoft's best documented path. The user needs an Azure subscription (the free tier works) and goes through more screens. |

Recommendation: the Developer Portal, if task 0.1 shows that replies work. If replies fail, the setup guide uses the Azure portal. The adapter code is the same for both paths; only the setup steps and the docs differ.

### D3. Agenta builds the Teams app package

| Option | Trade-off |
| --- | --- |
| **The adapter builds the zip, and /m offers a download button** | One click for the user. The zip travels in the existing per-connection setup document as base64 content, so no new route is needed. Python's `zipfile` builds it. Two small PNG icons ship in the repo. |
| The user builds the app in the Developer Portal's app editor | No code for Agenta, but about eight more steps for the user, and the bot id must be typed correctly. |

The setup document has `format: "zip"`, the zip bytes in `content` as base64, and a `filename`. The `ChannelSetupDoc` docstring states that a `zip` document is base64. One helper in the setup UI decodes it into a download, and the UI keeps `format` and `filename`, which it drops today.

The manifest id is a UUIDv5 of the bare `app_id` under one fixed namespace constant in the adapter. A new upload therefore updates the same app instead of installing a second one. `build_setup_document` already receives the `app_id` in the connection locator, so its inputs do not change. The manifest version is a constant in the adapter (for example `1.0.0`). It goes up in code only when the generated template or the icons change, because Teams ignores a package whose version did not change. Downloading the package twice gives the same release.

The manifest text comes from the `identity` argument of `build_setup_document` (`ChannelSetupIdentity`, `api/oss/src/core/channels/dtos.py:262-270`), fitted to the Teams manifest limits: `name.short` at most 30 characters and `description.short` at most 80 characters, on one line. The per-connection setup route passes `ChannelSetupIdentity(name=<the connection name>)` (today it passes no identity, `api/oss/src/apis/fastapi/channels/router.py:1068-1072`), so the Teams app shows the name the user gave the connection. When `identity` has no name, the name is "Agenta", as the Slack manifest does (`DEFAULT_SLACK_APP_NAME`, `api/oss/src/core/channels/adapters/slack/manifest.py:46`). When it has no description, the description is "An Agenta agent.". The developer fields are fixed: `developer.name` is "Agenta", and `developer.websiteUrl`, `developer.privacyUrl` and `developer.termsOfUseUrl` are all the deployment's public web URL, `env.agenta.web_url` (`AGENTA_WEB_URL`, `api/oss/src/utils/env.py:866`).

### D4. One messaging route that reads the bot from the request

| Option | Trade-off |
| --- | --- |
| **`POST /channels/teams/events/` for all bots. The unverified guess comes from the activity's `recipient.id`, and the verified token's audience must match the stored `app_id`** | One URL, like Slack. The inbound JWT proves the app id, so the guess cannot be abused. |
| `POST /channels/teams/events/{app_id}/`, like Telegram | The URL itself names the bot. It adds a path parameter and changes nothing about security. |

The app id appears in several forms. The setup screen and the stored connection use the bare GUID, named `app_id`. The activity's `recipient.id` and each mention's `mentioned.id` use the form `28:<app_id>`, which the adapter calls `bot_recipient_id`. The inbound JWT's audience can be `<app_id>`, `api://<app_id>` or `api://botid-<app_id>`. One helper in `teams/mapping.py` turns each wire form into the bare `app_id`, and every comparison uses the bare form. `verify_signature` returns the bare `app_id`, so `_connection_owns_identity` matches exactly.

The route answers 202 with the shared body, as the other channels do. Teams accepts any success status for messages.

### D5. Approval buttons use Submit, and the card is updated afterwards

| Option | Trade-off |
| --- | --- |
| **`Action.Submit` buttons. The button data carries the existing choice token. After the answer, `dismiss_choices` replaces the card with a copy that has no buttons** | No change to the shared ingress. OpenClaw and n8n do this. The buttons stay visible for a moment after the click, until the outbox updates the card. |
| `Action.Execute` buttons with a response hook in the ingress | The card changes in the same moment as the click, and Microsoft recommends this type. It adds a new interface method and a special response path to the shared ingress. |

The click still goes through `resolve_pending_choice`, which checks that the choice is still open and matches exactly. Any member of a channel can click a card in Teams, so this check and the existing grants matter.

### D6. How Teams places map to Agenta spaces and threads

This follows the Slack precedent: the space is the channel, and the thread is the reply chain under one root post.

| Teams place | `conversationType` | Space kind | Space key | Thread key |
| --- | --- | --- | --- | --- |
| Personal chat | `personal` | private | `tenant_id`, `conversation_id` | the space (core does this for private spaces); `thread_id` is `""` |
| Group chat | `groupChat` | group | `tenant_id`, `conversation_id` | space fields plus `thread_id` `""`, so one thread per chat, because group chats have no threads |
| Team channel | `channel` | topic | `tenant_id`, `conversation_id` | space fields plus `thread_id`, the root message id |

Teams' own `conversation.id` for a message in a channel thread is `19:...@thread.tacv2;messageid=<root id>`. Agenta's `conversation_id` is always that value without the `;messageid=` part, and `thread_id` holds the root id. One pair of helpers in `teams/mapping.py` splits the Teams value into the two fields and joins them back for a reply. A top-level post that mentions the bot is the root of its own thread, so its `thread_id` is its own activity id, and the reply goes into that thread, as in Slack.

### D6b. Names in each layer

The other adapters use different names for the same ideas (Slack `api_app_id`, Discord `application_id`), so the Teams names are fixed here. Each name keeps Microsoft's meaning.

| Name | Where | Meaning |
| --- | --- | --- |
| `app_id` | setup field, `data.connection_locator`, connection key | The bot's application (client) id, as a bare GUID. |
| `client_secret` | setup field (secret), new field on `ChannelSecretSettingsDTO`, kind `ChannelSecretKind.TEAMS` | The client secret value. It is used only to get access tokens. It is not the WhatsApp `app_secret`, which checks inbound signatures. The name matches `OAuthProviderSettingsDTO.client_secret` (`api/oss/src/core/secrets/dtos.py:289`). |
| `tenant_id` | setup field, connection data, space and thread keys | The directory (tenant) id. |
| `conversation_id` | locator, space and thread keys | Teams' conversation id without `;messageid=`. |
| `thread_id` | locator, thread key | The root message id of a channel thread, `""` in chats. |
| `service_url`, `message_id`, `title` | locator, not keys | Where replies go, the activity id of the message, and the channel or chat name. |
| `webhook_url` | connection data | The messaging endpoint. It reuses the field WhatsApp uses for its callback URL. The UI label is "Messaging endpoint". |

### D6c. The sender is the Entra object id

The sender id of an inbound event is `from.aadObjectId`, the user's object id in Microsoft Entra. It is the same for one person in every chat and for every bot, so grants and the roster match one person everywhere. `from.id` (`29:...`) is different for each bot and is not used for identity. An activity without `from.aadObjectId` is ignored.

| Option | Trade-off |
| --- | --- |
| **`from.aadObjectId`** | Stable across chats and bots. Teams sends it for every user in the tenant. |
| `from.id` | Always present, but it changes per bot, so a person's grants would not carry over to a second bot. |

### D7. Mentions are read from the mention list

The adapter marks a message as addressed when an entry in `entities` of type `mention` has a `mentioned.id` equal to the bot's `bot_recipient_id`. It does not read the `<at>` text to decide. It then removes only the bot's own mention text from the message, so a command such as `!new` after the mention parses with the existing grammar (`commands.py:35`). Other mentions stay in the text. A mention of a tag or of the whole channel does not address the bot.

### D8. Read all messages in shared places (open question)

| Option | Trade-off |
| --- | --- |
| **Off in v1** | Fewer permissions to explain at install. Teams already enforces the mention rule. The agent sees only messages that mention it. |
| On in v1 | The agent gets thread context, as it does in Slack. The team or chat owner must consent at install, and every message in those places is stored in the inbox. |

Recommendation: off in v1, because it keeps the install simple. It can be added later as a manifest change and a switch on the setup screen. The mention check in D7 already works for both options.

### D9. Progress while the agent works

| Option | Trade-off |
| --- | --- |
| **Typing signal, then the 30 second working message (`indicator: "native"`, `update: false`), as on WhatsApp** | Fewer requests. It avoids an open point in Microsoft's documentation about edits and streaming from a background worker. |
| "Thinking…" message edited with progress (`indicator: "message"`, `update: true`), as on Slack | Shows progress, but needs one PUT every 2 seconds per running turn. |

Streaming answers, where the text grows as the agent writes, can come later for personal chats.

### D10. Long answers, errors and ignored events

The adapter declares `max_chars` 20,000. This keeps each message far below Microsoft's 80 KB advice even with wide characters. Core splits longer answers.

The adapter's send call raises errors that carry `status_code`, so the shared outbox rules in `utils.py` decide what to retry (`api/oss/src/core/channels/utils.py:224-254`):

- A 429 and a connect error are retried, because Teams did not accept the message.
- A 5xx or a read timeout on a post is recorded as failed and not retried, because the message may have landed, and a retry could post it twice.
- A 401 first gets a new access token once and retries the call. A second 401 raises `ChannelCredentialRevoked`, which switches the connection off.
- A 403 with `MessageWritesBlocked` means a user or a team removed the app. It is a 4xx, so that one send is refused and not retried.

Install and uninstall events (`installationUpdate`, `conversationUpdate`) are ignored. Removing the app from one chat or one team does not stop the bot elsewhere, so `detect_deactivation` returns false.

| Option | Trade-off |
| --- | --- |
| **Ignore install and uninstall events** | One removed chat never switches off the whole bot. The connection stays active until the user archives it or the secret stops working. |
| Deactivate on `installationUpdate` `remove` | Matches Slack's `app_uninstalled`, but in Teams it fires per chat and per team, so one removal would stop the bot everywhere. |

### D11. Out of scope for v1

Files and images, Microsoft Graph history, message edits and deletes, reactions, native slash commands, streaming answers and a hosted bot. The capability declaration says so (see Interfaces).

## Interfaces

Fields are classified by role, as the `design-interfaces` skill asks: what the field is, who owns it, when it changes, and its role (data, config, policy, credentials, routing, metadata or protocol context).

### Capability declaration (`teams/capabilities.py`, the source of truth)

| Path | v1 value | Role | Why |
| --- | --- | --- | --- |
| `channel` | `"teams"` | routing | The registry key and the `channel` column value. |
| `addressing.sigils` | `{"agent": None, "command": "!"}` | protocol | Commands use `!`, as on Slack and Discord. No agent sigil, because without RSC a message without a mention never arrives in a shared place. |
| `addressing.mention` | `true` | protocol | The bot is addressed by a mention (D7). |
| `addressing.commands` | `native: false`, `in_conversation: true` | config | No registered Teams commands in v1. |
| `spaces` | `private: true`, `group: true`, `topic: true` | metadata | Personal chats, group chats and team channels (D6). |
| `conversation` | `units: ["thread", "space"]`, `default: "thread"`, `reply_window_seconds: 0` | config | No reply window in Teams. |
| `fill.backfill`, `fill.forwardfill` | backfill unsupported; forwardfill supported | metadata | No Graph history reads (D11). |
| `rendering.controls` | `update: false`, `ephemeral: false`, `indicator: "native"` | config | D9. |
| `rendering.buttons` | `supported: true`, `max: 5` | config | An approval has two buttons; five leaves room for other choices without crowding the card. |
| `rendering.text` | `format: "markdown"`, `max_chars: 20000` | config | D10. |
| `rendering.files` | `send` and `receive` unsupported | config | D11. |
| `identity.scope`, `identity.stable` | `"tenant"`, `true` | metadata | A bot lives in one tenant. |
| `identity.keys.connection` | `["app_id"]` | routing | D4, D6b. |
| `identity.keys.space` | `["tenant_id", "conversation_id"]` | routing | D6. |
| `identity.keys.thread` | `["tenant_id", "conversation_id", "thread_id"]` | routing | D6. |
| `setup.fields` | `app_id`, `client_secret`, `tenant_id` (see the connection spec) | credentials (`client_secret`), routing (`app_id`, `tenant_id`) | The three values the user enters. |
| `setup.instructions` | the setup steps | metadata | Final wording after task 0.1. |
| `commands` | `["new", "sessions", "use"]` | config | Same as Slack and Telegram. |

### Connection data

| Field | Where | Role | Owner | Changes |
| --- | --- | --- | --- | --- |
| `client_secret` | vault, under the connection's credential secret (kind `ChannelSecretKind.TEAMS`), new field on `ChannelSecretSettingsDTO` | credentials | user | when the user rotates the secret, or when it expires |
| `app_id` | `data.connection_locator`, and the source of `external_key` | routing (identity) | user, from the bot registration | never |
| `tenant_id` | `data.tenant_id` | routing, and the tenant for the access token URL and the inbound tenant check | user, from the bot registration | never |
| `webhook_url` | `data.webhook_url`, computed in `verify_connection` from `env.agenta.api_url` | config, shown to the user | Agenta deployment | when the deployment URL changes |

The access token is not stored. The adapter caches it in memory per connection (see the delivery spec).

### Inbound locator fields (`external_locator`)

| Field | Message | Card click | Role |
| --- | --- | --- | --- |
| `tenant_id` | `channelData.tenant.id`, else `conversation.tenantId` | same | routing (space and thread key) |
| `conversation_id` | `conversation.id` without `;messageid=` | same | routing (space and thread key) |
| `thread_id` | in a team channel: the `messageid` part of `conversation.id`, or the activity `id` for a top-level post; `""` in chats | same rule | routing (thread key) |
| `service_url` | `serviceUrl`, the value the inbound JWT vouched for | same | routing (where replies go, not a key) |
| `message_id` | the activity `id` | `replyToId`, the card's activity id | protocol context |
| `title` | the channel or chat name when Teams sends one | not set | metadata, the name of a new space |

`external_id` is the activity `id` for both a message and a click. The sender id is `from.aadObjectId` (D6c), and the sender name is `from.name`. A card button carries the choice token in its `data` as `{"choice_token": "<interaction UUID>:approve"}`. The outbox receipt for a posted message has the same shape, with `message_id` set to the id Teams returned for the posted activity.

### Setup document

| Field | Value | Role |
| --- | --- | --- |
| `format` | `"zip"` | protocol |
| `content` | base64 of the zip bytes | data |
| `filename` | a fixed file name ending in `.zip` | metadata |
| `link` | not set | none |

The zip holds:

- `manifest.json`: `id` (UUIDv5 of `app_id`, D3), `version` (adapter constant), `name.short` and `description.short` from `identity` with the defaults in D3, `developer.name` "Agenta" and the three developer URLs set to `env.agenta.web_url`, `bots[0].botId` = `app_id`, `bots[0].scopes` = `personal`, `groupChat`, `team`, no `webApplicationInfo` and no RSC permissions (D8), and the two icon file names.
- `color.png` (192 by 192) and `outline.png` (32 by 32, white on transparent), committed in the adapter folder.

`build_setup_document` returns `None` when the locator has no `app_id`, for example on the catalog setup call before any connection exists.

### Adapter mapping

| Interface method | Teams behavior |
| --- | --- |
| `fetch_capabilities` | The static declaration above. |
| `verify_connection` | Requests an access token with the three values. Refuses with `ChannelConnectionVerificationFailed` and a message per failure. Returns `app_id`, `tenant_id` and `webhook_url`. |
| `build_setup_document` | The app package zip (D3). |
| `activate_connection` | Not used. The user pastes the messaging endpoint into the bot registration. |
| `connection_locator` | `{"app_id": <bare app id>}` from `recipient.id`, unverified. |
| `verify_signature` | Checks the inbound JWT and returns the bare `app_id` from its audience. |
| `parse_event` | Message and card-click activities become events; everything else returns `None` (conversation spec). |
| `detect_deactivation` | Returns `false` (D10). |
| `post_message` | `POST {service_url}/v3/conversations/{conversation}/activities` (delivery spec). |
| `edit_message` | Not offered (`update: false`). |
| `dismiss_choices` | `PUT` of the card without buttons. |
| `signal_activity` | `POST` of a `typing` activity. |
| `discover_spaces`, `fetch_history` | `discover_spaces` returns nothing; spaces register on first message. `fetch_history` is never called, because backfill is unsupported. |
| `revoke_installation` | Returns `None`. The user removes the app in Teams. |

## Risks / Trade-offs

- **A bot registered only in the Developer Portal may fail to send replies.** One forum thread reports a 401 on sends. Task 0.1 settles this before the setup copy is final (D2).
- **Messages sent during an outage are lost.** Microsoft documents no retry when the endpoint is down. The other webhook channels have the same limit.
- **Buttons stay visible for a moment after a click** (D5). A second click on the same card resolves no pending choice, so it starts no turn.
- **A 5xx on a post is not retried.** The shared rule records it as failed, because the message may have landed. A user then sees no answer for that turn.
- **Every outbound activity carries the tenant.** The adapter sets `channelData.tenant.id` to the connection's `tenant_id` on each send, because Microsoft can refuse a send after the request ended without it.
- **Client secrets expire.** Tenant policy caps their lifetime. When the token request starts to fail with a rejected secret, the connection switches off and the agent page shows the revoked state, so the user can enter a new secret.
- **Custom app upload may be off in the user's tenant**, and it can take up to 24 hours to work after an admin turns it on. The setup screen says to ask the Teams admin.
- **Rate limits.** About 7 sends per second per conversation. Core splits a long answer into a few messages, which stays below this.
- **The adapter keeps two in-memory caches**: the Microsoft signing keys for the deployment, and one access token per connection. A restart empties them, and the next request fills them again.

## Migration

No database migration:

- `channel_connections.channel` is a plain `String` column (`api/oss/src/dbs/postgres/channels/dbas.py:40`), so the value `"teams"` needs no schema change.
- The vault row's `kind` column is the Postgres enum `secretkind_enum` over `SecretKind` (`api/oss/src/dbs/postgres/secrets/dbas.py:23`), and channel secrets use the existing member `SecretKind.CHANNEL_SECRET` (`api/oss/src/core/secrets/enums.py:10`). `ChannelSecretKind` is a field of `ChannelSecretDTO` (`api/oss/src/core/secrets/dtos.py:277-279`), which is written into the encrypted JSON `data` column with `model_dump(mode="json")` (`api/oss/src/dbs/postgres/secrets/mappings.py:66-72`). The new member `TEAMS` is therefore a JSON value, not a database enum value.

No new environment variable and no Helm, compose or Railway change. `pyjwt[crypto]` is added to `api/pyproject.toml`; the lock already has it, so the API image is rebuilt with the same version. Rollback is removing the `teams` registry entry and the route.

## Open Questions

| # | Question | Recommendation |
| --- | --- | --- |
| D2 | Where does the user register the bot? | Teams Developer Portal, if task 0.1 shows that replies work; else the Azure portal. |
| D8 | Does the bot read all messages in shared places? | Off in v1. |
