# Design: Agenta's hosted WhatsApp number

Status: draft for Mahmoud's review. The code facts below were read on `origin/main` (hosted Telegram) and on `feat/whatsapp-channel` at `6392c62904` (bring-your-own WhatsApp, PR #7132).

## Context

### How hosted Telegram works today

Hosted Telegram (`telegram_hosted`) is one Agenta-owned bot per deployment, shared by every project.

- **Mint.** The connect card calls `POST /channels/catalog/channels/telegram_hosted/bind-link/`. `ChannelsService.ensure_hosted_telegram_connection` creates or reuses the project's one hosted connection (keyed on the project, flagged `is_hosted`) and its one default channel agent. If the default agent points at a different Agenta agent, it retargets it to the calling agent. `TelegramBindingService.issue_bind_link` (`api/oss/src/core/channels/telegram_binding.py`) stores a one-time token (`token_urlsafe(32)`, 30-minute TTL) and returns `https://t.me/<bot>?start=<token>`.
- **Bind.** Telegram posts every update to `/channels/telegram/events/<bot_id>/`. `ChannelsIngressRouter._ingest_hosted` checks the deployment webhook secret, drops non-private chats, and treats `/start <token>` as a bind. `consume_bind_token` writes the chat binding and the account link (the sender's `external_user_key` linked to the Agenta user who minted the token) in one transaction.
- **Refusals.** A chat bound to another project gets "connected to another Agenta project, disconnect it first". A fresh token in a chat already bound to this project gets "already connected, disconnect first to change the agent". A spent, expired or unknown token gets "That connection link is not valid anymore". A replayed `/start` with the completing token is idempotent.
- **Routing.** Any other message is routed by `(bot_id, chat_id)` to `(project, connection)` through `channel_telegram_chat_bindings` (migration `oss000000035`). An unbound chat is ignored silently.
- **Unbinding.** Disconnect in Agenta archives the hosted connection and `release_connection_bindings` frees every chat bound to it.
- **UI.** `ChannelConnectFlow.tsx` in `@agenta/settings-ui` shows a QR code and a button, polls `GET /catalog/channels/telegram_hosted/bindings/?connection_id=` every 2.5 seconds, and moves from `qr` to `linked`, or to `expired` after 30 minutes.
- **Config.** `TELEGRAM_HOSTED_BOT_TOKEN`, `TELEGRAM_HOSTED_BOT_USERNAME`, `TELEGRAM_HOSTED_WEBHOOK_SECRET`. All three set means `env.channels.telegram.enabled`, which switches `hosted_setup_available()` on. Ops sets the webhook once by hand, per deployment.

### What bring-your-own WhatsApp already does

PR #7132 added the `whatsapp` adapter (`api/oss/src/core/channels/adapters/whatsapp/`): the GET verify handshake and the signed POST on `/channels/whatsapp/events/`, batched bodies, one space and one thread per customer `wa_id`, the typing indicator and one "working on it" message, splitting at 4096 characters, reply buttons and lists, images and documents in, the 24-hour window with the `HELD` delivery state and release on the next customer message, the optional re-open template, STOP and START, the connect-time send probe, and the outbox rule that a 4xx other than a 429 is a refusal that is not retried.

Everything in that list works for a shared number too. Only three things are per connection in the adapter today: the phone number ID, the access token, and the app secret. The hosted adapter reads those three from the deployment env instead, the way `HostedTelegramAdapter` reads its token and secret.

### Platform facts this design relies on

- **Prefilled links.** `https://wa.me/<digits>?text=<url-encoded text>` opens a chat with the number and puts the text in the compose box. The user can edit it before sending. The same URL works as a QR code.
- **Messaging limits exclude service windows.** Meta's messaging limits page: limits are "the maximum number of unique WhatsApp user phone numbers your business can deliver messages to, outside of a customer service window". New business portfolios start at 250 and move to 2,000 after business verification. Limits are set at the business portfolio level and shared by every number in it. Every hosted conversation starts with the user's own message, so the 250 limit only touches re-open templates.
- **Pricing.** From October 1, 2026, replies inside the window are charged at the utility rate after 1,000 free messages per number per month (from the `whatsapp-channel` research notes; the rate depends on the recipient's country). Templates are always charged.
- **Quality rating.** Blocks and reports from users lower a number's quality rating. A low rating can block tier increases and, in the worst case, restrict the number. On a shared number, one project's users affect everyone's number.
- **Webhook overrides.** A Meta app has one callback URL, but an app can set an alternate callback URL on a WhatsApp Business Account or on a single business phone number (`override_callback_uri`). The phone number override wins.
- **Display name.** Each number's display name is reviewed by Meta. The business portfolio behind it needs business verification to raise limits.

## Goals and non-goals

**Goals.** A user connects an agent to WhatsApp in under a minute, with no Meta account. The flow, the data model and the chat behavior match hosted Telegram wherever WhatsApp allows. The new code is small: a subclass, an ingress branch, two routes that mirror Telegram's, one migration, one capability field, and one UI tab.

**Non-goals.** Customers of a business talking to that business's agent on Agenta's number (that is bring-your-own). Groups. Business-initiated messages. Billing users for WhatsApp. A single global number with a cross-region router. A command language for switching agents from the chat.

## Decisions

Each decision names the Telegram behavior it mirrors. "Same as Telegram" means the code path is shared or copied without a WhatsApp-specific rule.

### D1. Binding a phone: a `wa.me` link with a prefilled message and a short code

The bind link is `https://wa.me/<WHATSAPP_HOSTED_DISPLAY_NUMBER>?text=<message>`, shown as a QR code and an "Open WhatsApp" button. The message is:

> Hi Agenta! Connect my WhatsApp. Code: K7QM-4XRT-9BDA

The code is 12 characters from the Crockford base32 alphabet (no I, L, O or U), shown in three groups of four. That is 60 bits, one-time, and valid for 30 minutes, which makes guessing a live code impractical. Matching is forgiving about everything except the code itself: Agenta upper-cases the text, finds the first run of 12 code characters with optional dashes or spaces between the groups, and looks it up. The user may delete "Hi Agenta!" or add words, and the bind still works.

On success, Agenta replies with the same greeting as Telegram: "You are connected. Send a message and your agent will reply."

Alternatives:

- **Reuse Telegram's 43-character token.** Rejected. It would sit in the user's chat as an unreadable blob, and a person reading it cannot tell what they are sending.
- **A 6-digit code the user types.** Rejected. 20 bits is guessable within 30 minutes by anyone who scripts messages, and a guessed code binds a stranger's phone to someone's agent under that person's account.
- **Meta's own "message QR codes" API.** Rejected. It creates a QR per message through the Graph API and needs cleanup. A `wa.me` URL rendered with our existing `QrCode` component does the same job with no API call.

### D2. A bad, edited, or repeated code: the same replies as Telegram

A message counts as a bind attempt when it contains a code-shaped string. Then:

| Case | Telegram today | WhatsApp hosted |
| --- | --- | --- |
| Valid code, phone not bound | Bind, greet | Same |
| Code-shaped but unknown, spent or expired, phone not bound | "That connection link is not valid anymore. Please generate a new one from Agenta and try again." | Same text |
| Code-shaped but unknown, phone bound | (a `/start` is always a bind attempt) | Routed to the agent as an ordinary message, so an order number like `AB12-CD34-EF56` does not trigger a refusal |
| Valid code for this project, phone already bound here | "This chat is already connected to Agenta..." | Same text |
| Valid code for another project, phone bound elsewhere | "This Telegram chat is connected to another Agenta project..." | Same text with "WhatsApp number" |
| The completing code, re-delivered by Meta | Idempotent success | Same |

The only WhatsApp-specific rule is the third row: a bound phone's code-shaped text that matches no token is just a message. It exists because WhatsApp has no `/start` command to mark intent.

Alternative: require the phrase "Connect my WhatsApp" as well. Rejected: users edit prefilled text, and the code alone already marks intent.

### D3. One phone, several agents or projects: same as Telegram

A phone is bound to at most one project on a deployment, because the binding is unique on (channel, number, phone). A project has one hosted WhatsApp connection with one answering agent. Pressing "Use Agenta's WhatsApp" on another agent's card in the same project retargets that connection to the new agent at mint time, so every phone bound to the project now talks to the new agent. The phone does not need to scan again. If it does, it gets "already connected". To move a phone to another project, the user disconnects WhatsApp in the first project, then connects in the second.

This is exactly what hosted Telegram does. WhatsApp has the same constraint as Telegram: a phone has exactly one chat with Agenta's number, so there is no second chat to bind to a second agent.

Alternatives:

- **An in-chat switch command** ("/agent sales"). Rejected for v1. It needs a list of agents per phone, a many-to-many binding, and a new command. Nothing in Telegram has it yet, and both channels would want it together.
- **One binding per (phone, project), with the last-used project answering.** Rejected. It makes "who answers this message" depend on history, which users cannot see.

### D4. Unbinding: same as Telegram, plus the STOP that already exists

Disconnect in Agenta archives the project's hosted WhatsApp connection and frees every phone bound to it, through the same `release_connection_bindings` call Telegram uses. The disconnect notice is Telegram's: nothing to remove on Meta's side.

From the phone, STOP and START keep their bring-your-own meaning: the phone stays bound, and the agent does not answer until START. This is already built and needs no hosted code.

Alternatives:

- **STOP also unbinds.** Rejected. It would give STOP two meanings across the two WhatsApp channels, and a user who sends START would then need a new code.
- **A per-phone "Remove" button in the manage panel.** Deferred for both hosted channels. Telegram does not have it either. Add it for both when a project has several people bound and wants to remove one.

### D5. Messages from phones that never bound: silent, plus a profile description

An unbound phone that sends anything without a code-shaped string gets no reply, the same as an unbound Telegram chat. The number's WhatsApp business profile carries a one-line description instead: "This is Agenta's WhatsApp. Connect it from your agent at agenta.ai." Anyone who opens the chat sees it, and it costs nothing.

Alternatives:

- **Reply once with "Connect me from Agenta".** Each reply is a billed message after the free tier, and a spammer with many numbers could make us send thousands. Replying "once per phone" also needs a store of phones we already answered. Kept as a follow-up if QA shows confused users.
- **Reply every time.** Rejected. Cost and spam, as above, and a reply loop with another bot is possible.

### D6. Routing: phone, then binding, then agent

Inbound events for the hosted number resolve `(phone_number_id, wa_id)` to `(project, connection)` through the binding table, then run through the normal inbox, `ChannelsService.resolve`, and the connection's default agent. This is Telegram's `(bot_id, chat_id)` routing with WhatsApp's two ids. The space and the thread key on `wa_id`, as in bring-your-own.

Runs are attributed to the Agenta user who minted the code, through the account link written at bind time. The `whatsapp_hosted` capability declares `identity.scope = "project"` with `space` and `thread` on `wa_id`, so the key the bind writes is the key the inbox worker composes.

### D7. Data model: reuse the hosted Telegram bind tables and service

Migration `oss000000037` adds a `channel` column (server default `telegram_hosted`) to `channel_telegram_bind_tokens` and `channel_telegram_chat_bindings`, and replaces the unique key on bindings with `(channel, bot_id, chat_id)`. For WhatsApp, `bot_id` holds the hosted phone number ID and `chat_id` holds the `wa_id`. `TelegramBindingService` becomes `HostedBindingService` in `api/oss/src/core/channels/hosted_binding.py`. It takes the channel, the capabilities, and a small link format (how to mint a code and how to build the URL). `api/entrypoints/routers.py` builds one instance per configured hosted channel. `consume_bind_token` checks that the token's channel matches the ingress channel, so a Telegram token sent to WhatsApp is unknown.

The table names keep "telegram". Renaming live tables buys nothing for users and costs a riskier migration.

Alternatives:

- **Two new WhatsApp tables and a copied service.** Rejected. The bind rules (TTL, one-time use, atomic bind and account link, bound elsewhere, already connected, release on disconnect) are one policy. Two copies would drift.
- **Rename the tables to `channel_bind_tokens` and `channel_chat_bindings`.** Rejected for now, as above. Cheap to do later in a cleanup migration if the name confuses someone.

### D8. Who pays Meta, and the per-project daily cap

Agenta pays Meta for the hosted number. After the 1,000 free service messages a month, every reply costs the utility rate for the recipient's country. The bill grows with usage across all projects on the deployment.

The guard is one documented limit: each project's hosted WhatsApp connection sends at most `WHATSAPP_HOSTED_DAILY_MESSAGE_CAP` messages (default 100) in any rolling 24 hours. The hosted capability declares it as `conversation.daily_message_cap`. The outbox's `_deliver` counts the connection's sent rows in the last 24 hours before each send, the same place it checks the reply window. At the cap, it sends one fixed notice ("This agent reached today's message limit on Agenta's WhatsApp. It will answer again within 24 hours. To remove the limit, connect your own WhatsApp number in Agenta.") and marks the reply failed with the reason `daily_cap`. Above the cap it marks replies failed and sends nothing. "Send the notice only when the count equals the cap" needs no stored flag: the notice itself is the row that moves the count past the cap. Every part of a split answer, the working message, and a re-open template count as messages.

In the product, the limit appears in two places: one line on the hosted tab ("Agenta's WhatsApp allows 100 messages per project per day. Use your own number for more.") and the `daily_cap` reason in Settings > Channels outbound events.

Alternatives:

- **No cap.** Simplest, but one busy project can run up the bill and the quality risk for everyone.
- **Count against the user's Agenta plan or credits.** Rejected for v1. It couples Channels to billing, and there is no per-message credit today.
- **A cap on bound phones per project.** Not needed. Every bind needs an editor to mint a one-time code, so bound phones are people the editor chose.

### D9. The 24-hour window: reuse held replies, register one template

Held replies, release on the next message, and STOP work as in bring-your-own, with no hosted code. The difference is who owns the re-open template. On bring-your-own the operator picks one. On the hosted number Agenta registers one utility template in its own WhatsApp Business Account and the hosted adapter always uses it:

- Name `agenta_reply_ready`, category Utility, language `en`, no variables.
- Body: "Your Agenta agent has a reply for you. Send any message to see it."

It is sent once per held stretch, as today, and is billed and counted against the daily cap. No variables means no user text reaches a template, so Meta cannot recategorize it as marketing because of an agent's name.

Alternatives:

- **No template: hold and wait.** Free and simplest. The user sees nothing until they write again, which is fine for chat but loses long-running answers. Acceptable if Mahmoud wants zero template operations.
- **One template per language.** Deferred. English first; add languages when users ask.
- **A template with the agent name as a variable.** Rejected, as above.

### D10. Number, profile, regions, verification and quality

One number per deployment, the way we run one Telegram bot and one Slack app per deployment: EU, US and staging. All three numbers live in one WhatsApp Business Account under Agenta's verified business portfolio. One Meta app serves EU and US, and each number sets its own callback URL with a phone-number webhook override. Staging uses a separate Meta app and number so a test cannot touch the production portfolio's quality or limits. The display name is "Agenta", the profile description is the D5 line, and the profile picture is the Agenta mark.

Business verification of Agenta's portfolio is a prerequisite for production, because it lifts the template limit from 250 to 2,000 a day and supports display name approval. Service replies are not limited either way.

Quality is shared by every project on a number. The guards are the D8 cap, the one-time codes that keep strangers from binding, and the D5 silence to strangers. The kill switch is operational: unset the hosted env vars and the hosted tab disappears and the ingress stops answering the hosted number, while bring-your-own keeps working.

Alternatives:

- **One Meta app per region**, as the Slack ops note does. Also fine and needs no override call, but three apps mean three app secrets, three app reviews, and three places to register the template. Choose this if the override behaves badly in QA.
- **One global number and a routing front door.** Rejected for v1, as for Telegram. It needs a cross-region phone-to-region map.

### D11. Config: five env vars, webhook set once by ops

| Variable | Mirrors | Meaning |
| --- | --- | --- |
| `WHATSAPP_HOSTED_PHONE_NUMBER_ID` | the bot id in the Telegram token | The number's Graph API id. The ingress takes the hosted branch when an event names it. |
| `WHATSAPP_HOSTED_ACCESS_TOKEN` | `TELEGRAM_HOSTED_BOT_TOKEN` | A permanent system-user token of Agenta's business, for sends. |
| `WHATSAPP_HOSTED_APP_SECRET` | `TELEGRAM_HOSTED_WEBHOOK_SECRET` | Verifies `X-Hub-Signature-256` on every hosted event. |
| `WHATSAPP_HOSTED_VERIFY_TOKEN` | (Telegram has no handshake) | Answers Meta's GET verify handshake for the hosted callback. |
| `WHATSAPP_HOSTED_DISPLAY_NUMBER` | `TELEGRAM_HOSTED_BOT_USERNAME` | The number in international format, digits only, for the `wa.me` link. |
| `WHATSAPP_HOSTED_DAILY_MESSAGE_CAP` | (new, optional) | D8. Default 100. |

`env.channels.whatsapp.hosted.enabled` is true only when the first five are set. They live on `api`, `worker-queues` and `worker-streams`, like Telegram's. Ops sets the callback URL `<AGENTA_API_URL>/channels/whatsapp/events/` and the verify token once, and subscribes the app to the `messages` field. Nothing in code or deploy calls Meta's subscription APIs.

Alternative: read the display number from the Graph API at startup instead of an env var. Rejected: a network call at boot for one static string.

### D12. What is reused as is, and what is new

Reused unchanged: the WhatsApp GET and POST routes, signature checking, batched bodies, parsing, typing, the working message, splitting, buttons and lists, media in, the window and held replies, STOP and START, the outbox refusal rules, and the hosted Telegram bind rules, account link, disconnect release, and connect-flow states.

New:

1. `WhatsAppAdapter` reads its number, token and app secret through three overridable methods instead of module functions.
2. `HostedWhatsAppAdapter` and `WHATSAPP_HOSTED_CAPABILITIES` (a copy of the bring-your-own declaration with the hosted identity, no setup fields, and the daily cap).
3. A hosted branch in `verify_whatsapp_webhook` and `ingest_whatsapp_event`.
4. `HostedBindingService` generalized from the Telegram one, with the code format and link builder; migration `oss000000037`.
5. `ensure_hosted_connection(channel=...)` generalized from `ensure_hosted_telegram_connection`.
6. Two catalog routes that mirror Telegram's.
7. The daily cap check in the outbox.
8. The hosted tab in the WhatsApp card.

### D13. The UI

The WhatsApp card gets the same two-tab switch as Telegram: "Agenta's WhatsApp" and "Your own number". The hosted tab opens by default when the deployment has the hosted number (`hosted_available`), and otherwise the card shows only the bring-your-own form, as today. The hosted tab reuses Telegram's steps (`preparing`, `qr`, `waiting`, `linked`, `expired`, `unavailable`) with WhatsApp strings:

- "Scan with your phone, or open WhatsApp on this device. Send the message as it is."
- A QR code and an "Open WhatsApp" button for the same link.
- "Waiting for your message..." while it polls.
- The daily limit line from D8.

`ChannelConnectFlow.tsx` generalizes its Telegram hosted state into one hosted-link state keyed by platform, and `actions.ts` gains `connectHostedWhatsApp` and `countHostedWhatsAppBindings`, mirroring the Telegram pair.

### D14. Policy note

Meta's WhatsApp Business Solution Terms bar "AI Providers" whose AI is the primary functionality offered, from January 15, 2026 for existing users. A shared Agenta number that runs user agents is closer to that shape than bring-your-own, where each business is the sender of record. Mahmoud's own research concluded that one Agenta number per deployment is allowed. This design records that conclusion as its context and does not revisit it.

Two facts support it. Agenta is an EU company, and the European Commission's interim measures of June 9, 2026 require Meta to keep access open for AI providers in the EU and EEA while its investigation runs. And every hosted conversation is started by the user, with a code that an Agenta editor minted for them.

If Meta restricts the number, the kill switch in D10 turns the hosted path off without touching bring-your-own.

## Risks and trade-offs

- **Meta policy or enforcement changes.** Mitigation: D14 kill switch; bring-your-own stays available.
- **Shared quality rating.** One project's users blocking the number hurts everyone. Mitigation: D8 cap, one-time codes, silence to strangers. Watch the quality webhook in logs.
- **Cost.** Every reply after the free tier costs money. Mitigation: D8 cap. The cap is per project, so many projects still add up; review the monthly bill after launch.
- **Personal data.** Agenta becomes the controller for phone numbers on the hosted number. The binding stores `wa_id`, as the inbox already does. Disconnect frees the binding; retention of inbox rows follows the existing channel retention work.
- **The "already connected" quirk,** shared with Telegram: re-scanning in a bound phone gets "already connected" while the card keeps waiting until the code expires, because the binding count does not grow. Not fixed here; fix it for both channels together.
- **Unverified platform details.** The exact free-tier scope (per number or per portfolio) and the phone-number webhook override in practice. QA checks both before launch.

## Effort estimate

| Phase | Scope | Estimate |
| --- | --- | --- |
| 1 | Generalize the bind service and tables for a channel, migration `oss000000037` | 1.5 to 2 engineer-days |
| 2 | Hosted adapter, capabilities, env, ingress branch, bind by code, replies | 2 to 3 engineer-days |
| 3 | Catalog routes, `ensure_hosted_connection`, daily cap in the outbox | 1.5 to 2 engineer-days |
| 4 | Connect card hosted tab | 1.5 to 2 engineer-days |
| 5 | Meta setup per region, template, docs, live QA | 2 to 3 engineer-days, plus Meta review time for business verification, display names and the template (days to a few weeks) |
| | **Total** | **8.5 to 12 engineer-days** |

## Sources

- Messaging limits (service windows excluded, portfolio level, 250 and 2,000): https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- Webhook overrides: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/
- Pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- October 2026 service pricing change: https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026
- Template categories: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
- Meta Terms for WhatsApp Business Platform: https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform
- EU interim measures: https://ec.europa.eu/commission/presscorner/detail/en/ip_26_1276
- Bring-your-own design: `openspec/changes/whatsapp-channel/design.md` on this branch
