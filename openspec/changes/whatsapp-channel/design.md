# Design

Status: Approved on 2026-09-24. D9 is option B. No Meta-side setup is included. The code facts below were read on `main` at `2f9cf635ca`.

## Context

### How Channels works today

Every platform is one adapter behind `ChannelAdapterInterface` (`api/oss/src/core/channels/adapters/interface.py`). An adapter declares a static capability document (`capabilities.py`) and implements:

- **Setup:** `verify_connection` proves a pasted credential before the row is written. `activate_connection` runs platform calls that write, after the row exists (Telegram's `setWebhook`). `hosted_setup_available` switches on a one-click, Agenta-owned install.
- **Ingress:** `connection_locator` reads an unverified claim of which connection a request belongs to. `verify_signature` proves it. `parse_event` turns the payload into a `ChannelInboundEvent` with `space_kind` (private or group) and `addressed`.
- **Egress:** `post_message`, `edit_message`, `dismiss_choices`, and `signal_activity` (Telegram's typing action, re-sent while a turn runs).
- **Discovery and history:** `discover_spaces` and `fetch_history`. Telegram returns nothing for both.

`ChannelsService.resolve` creates a space on first contact, picks the agent, applies grants, and runs `_is_trigger`. A private space is always a trigger, and a private space keys its thread on the space, so a DM is one running conversation. The ingress (`api/oss/src/apis/fastapi/channels/ingress.py`) has one literal POST route per platform. Slack's `url_verification` handshake is answered on the same route.

The outbox (`api/oss/src/tasks/asyncio/channels/outbox.py`) posts a "Thinking…" indicator when a turn starts. When the capability says `rendering.controls.update`, it edits that message with progress and then with the answer. When it does not, the answer is posted as a new message. Approval cards render as buttons when `rendering.buttons.max` is at least the option count, and otherwise as numbered text. Typed labels and numbers resolve through `resolve_pending_choice`.

Hosted Telegram (`telegram_hosted`) is one Agenta-owned bot shared by every project. A bind link maps a chat to a project, and hosted groups are dropped. The ops note records that one hosted bot or app cannot serve both the EU and US regions, because each has one webhook URL.

### Where WhatsApp fits badly

| Existing feature | WhatsApp reality | Consequence |
| --- | --- | --- |
| Edit the indicator into the answer | The Cloud API cannot edit or delete a sent message. | `controls.update` is false. No "Thinking…" message that turns into the answer. |
| Progress edits while a turn runs | No edits and no streaming. | Typing indicator only, plus one optional "working on it" message. |
| Typing indicator | Exists, is tied to an inbound message ID, marks it read, and lasts about 25 seconds. | `signal_activity` needs the last inbound message ID in the locator. Refresh every 20 seconds. |
| Buttons | At most 3 reply buttons, titles up to 20 characters. Lists allow up to 10 rows. | Approve and Deny fit. Longer choice sets need a list or text. |
| Threads and groups | One chat per customer. The Groups API needs an Official Business Account and invite links. | Private spaces only. Thread key equals space key. |
| Replies at any time | Free-form messages only within 24 hours of the customer's last message. Error `131047` otherwise. | New held state and window tracking. |
| Discover spaces and history | No API to list chats or read history. | Both return nothing, as on Telegram. |
| Webhook registration | A GET verify handshake, then POSTs signed with `X-Hub-Signature-256` using the app secret. | A new GET route and HMAC check. |
| Who is talking | Senders are members of the public, not Agenta users. | Runs attribute to the agent owner, as unbound Telegram senders do. Phone numbers are personal data. |

### Platform facts this design relies on

- On-Premises API is sunset since October 23, 2025. Only the Cloud API is in scope.
- Messages carry `entry[].changes[].value` with `messages[]`, `statuses[]`, `contacts[]`, and `metadata.phone_number_id`. Button taps arrive as `interactive.button_reply` and list picks as `interactive.list_reply`.
- Per-message pricing started July 1, 2025. From October 1, 2026, service replies inside the window are charged at the utility rate after 1,000 free messages per number per month.
- Throughput is 80 messages per second per number. The pair limit is about one message every 6 seconds to the same user (error `131056`). Unverified businesses can start 250 unique conversations per day.
- Meta's WhatsApp Business Solution Terms bar "AI Providers" whose AI is the primary functionality offered. New registrants were bound from October 15, 2025, and existing users from January 15, 2026. Focused support, booking and order agents stay allowed. EU interim measures from June 9, 2026 require Meta to restore access in the EU and EEA while the investigation runs.

Sources are listed at the end.

## Goals / Non-Goals

**Goals:** Let a business answer its own WhatsApp customers with an Agenta agent. Reuse the adapter interface, routing, inbox, outbox, approvals, and grants unchanged where possible. Never send a message Meta will reject or bill unexpectedly. Keep Agenta outside Meta billing. Agenta never runs a shared number, so each business is the sender of record for its own agent.

**Non-Goals:** No Agenta-owned shared number. No groups. No business-initiated campaigns or marketing templates. No voice notes, video, stickers, locations, or contacts cards in v1. No WhatsApp Flows. No Meta credit line or resale of Meta messaging.

## Decisions

### D1. Connect: bring your own number first, Embedded Signup second, no shared number

Phase 1 is a paste form with the phone number ID, a permanent system-user access token, and the app secret. `verify_connection` reads the phone number's display name and verified name with the token and fails if it cannot. Agenta shows the webhook URL and a generated verify token for the customer to paste into their Meta app. The connection keys on `phone_number_id`.

Phase 2 adds Embedded Signup. Agenta becomes a Meta Tech Provider: business verification of Agenta's Meta business, app review for `whatsapp_business_management` and `whatsapp_business_messaging`, and one Meta app per region. The popup returns a code that the backend exchanges for a business token. The connection keys on the same `phone_number_id`. Both paths share one adapter. Only setup and the token source differ, the way `telegram_hosted` differs from `telegram`.

Alternatives:

- **Shared Agenta number, bound by a code like hosted Telegram.** Rejected. End customers of a business would chat with "Agenta", not the business. Agenta would be the business of record for every conversation, which puts it closest to the banned "general-purpose AI assistant" shape. One number's quality rating would be shared by every customer.
- **Embedded Signup only.** Rejected for v1. It blocks on Meta app review and Tech Provider onboarding, which take weeks and which we cannot control, and it does not work for self-hosted installs.
- **Bring your own only, forever.** Possible, but the paste flow takes a customer 20 to 40 minutes in Meta Business Manager. Embedded Signup is the expected path for a hosted product.

### D2. Outside the 24-hour window: hold, mark, optionally re-open with a template

The adapter records the time of each inbound customer message on the space. Before posting, the outbox checks the window. If it has closed, the delivery moves to a new `held` state with the reason `window_closed`, and the session shows it. If the operator configured a re-open template for the connection, the outbox sends that approved template instead, keeps the held reply, and posts the held reply when the customer answers. If the provider still returns `131047`, the same held path applies.

Alternatives:

- **Always send a template.** Rejected as a default. It costs money per message and needs an approved template per language, and a template cannot carry the agent's actual answer.
- **Drop the reply silently.** Rejected. It hides a real failure from the operator.
- **Notify the operator only (email or Agenta inbox).** Kept as a later addition on top of the held state.

### D3. Long turns: typing indicator, one "working on it" message, then the answer

`controls.update` is false. The turn-start indicator is native only: the adapter marks the triggering message as read and shows the typing indicator, and posts no text. `signal_activity` refreshes the indicator every 20 seconds. If no answer is ready after 30 seconds, the outbox sends one fixed "Working on it, I'll reply here when I'm done." message per turn. The final answer is posted as new messages, split at 4096 characters on paragraph or line boundaries, with at least 6 seconds between parts to the same customer.

This needs one core change: an adapter can declare that its indicator is native only, so the outbox does not post a "Thinking…" message it can never replace.

Alternatives:

- **Post "Thinking…" and then the answer.** Rejected. It leaves a stale bubble in every conversation.
- **Stream partial answers as separate messages.** Rejected. It floods the chat, hits the pair limit, and each message counts toward billing after October 2026.
- **Typing indicator only.** Acceptable, but a customer who sees nothing for two minutes assumes the business is gone.

### D4. Approvals and choices: buttons, list, then text

Up to 3 options render as reply buttons. The button ID carries the choice token and the title carries the label, cut to 20 characters. From 4 to 10 options render as a list message. More than 10 render as numbered text. Typed labels and numbers keep working through `resolve_pending_choice`. The capability declares `buttons.max = 3`, and a new list limit lets the renderer pick a list before falling back to text. Approval arguments are shown in the message body, redacted as today, within the 1024-character body limit for interactive messages.

Alternatives: text only (works everywhere, but worse on mobile), or a CTA link to approve in Agenta (safer for sensitive tools, but the customer is not an Agenta user).

### D5. One-to-one only

Every WhatsApp space is private. The space and thread key on `(phone_number_id, wa_id)`. The capability declares no groups and no topics. Group messages, if Meta ever delivers them, are stored and not answered.

Alternative: build on the Groups API. Rejected for v1. It is limited to Official Business Accounts and invite links, and the limits are not yet stable.

### D6. Media: images and documents in and out

Inbound images and documents are downloaded with the connection's token, stored as session attachments, and passed to the agent. Outbound files the agent produces are uploaded and sent as image or document messages. Limits follow Meta: images up to 5 MB, documents up to 100 MB. A file over the limit is replaced by a short text notice. Audio, video, and stickers are acknowledged with a fixed "I can only read text, images and documents here" reply.

Alternatives: text only in v1 (simpler, but customers send screenshots and PDFs all the time), or everything including voice notes (needs transcription, which is a separate project).

### D7. The customer pays Meta directly

On both connection paths the WhatsApp Business Account belongs to the customer and carries their payment method. Agenta never extends a credit line and never appears on the Meta invoice. The connect screen says so.

Alternative: Agenta as a Solution Partner with a credit line and resale margin. Rejected. It makes Agenta liable for all customer spend and needs a separate partner agreement.

### D8. Opt-in: inbound conversations only, STOP honored

v1 answers only conversations the customer starts, which is Meta's clearest form of consent. It sends no business-initiated messages, except the operator's optional re-open template in D2, which is only sent to someone who already wrote to the business. The adapter treats `STOP` (and `UNSUBSCRIBE`) as an opt-out: the space is marked opted out, one confirmation is sent, and later messages are stored but not answered until the customer sends `START`.

Alternatives: allow proactive messages from the channel tools proposal (needs a recorded opt-in per customer and template management), or no opt-out handling (risks blocks and reports that lower the number's quality rating).

### D9. Meta's AI policy: no Agenta-added rules

Agenta adds no rules of its own. The connect flow has no policy notice, no confirmation checkbox, and no restriction on the kind of agent, and Agenta's terms get no WhatsApp-specific clause. Each business connects its own number under its own Meta account and is responsible for its own use of WhatsApp under Meta's terms, as it is for any other channel.

Context: Agenta is an EU company. The European Commission's interim measures of June 9, 2026 currently require Meta to allow access for AI providers in the EU and EEA while its investigation runs. Outside the EU, Meta's terms bar "AI Providers" whose AI is the primary functionality offered, and Meta decides this at its discretion. Because Agenta never offers a shared number (D1), the business, not Agenta, is the sender of record.

Alternatives:

- **Focused business agents only (option A).** A short notice and a required checkbox on the connect screen, plus a clause in Agenta's terms. Rejected by Mahmoud on 2026-09-24: it adds rules and wording Agenta does not need, and the EU measures currently force access.
- **Automatically check the agent's prompt.** Rejected. Unreliable and intrusive.

## As built (v1)

The code follows the decisions above with these small core changes and documented limits. Each limit trades rare-case machinery for a narrower contract.

Core changes, all declared by the adapter's capabilities so Slack and Telegram are unchanged:

- `rendering.controls.indicator = "native"`: the outbox sends no "Thinking…" message. It signals typing when the turn starts, refreshes it every 20 seconds, and sends one working message after 30 seconds, on its own outbox row so a redelivered event cannot send it twice.
- `conversation.reply_window_seconds` and a `HELD` delivery state. The window is derived from the space's latest inbound message, so no new field is stored. A held row is only claimable by the release path.
- `parse_event` may return a list. The WhatsApp route verifies each business number in a batched body on its own and skips numbers not connected here.
- `conversation.opt_out` and a space flag `is_opted_out` for STOP and START.
- Two adapter hooks with no-op defaults: `reopen_conversation` (the template) and `fetch_media` (inbound files).

Documented limits:

- Delivery statuses are logged, with failed ones at warning level and Meta's code. They are not written back to the outbox row. Error 131047 in a send response holds the reply; a 131047 that only arrives later as a status is logged. The window check before sending makes that case rare.
- The pair rate limit (131056) is retried twice after 6 seconds. There is no fixed spacing between the parts of a long answer, because Meta allows short bursts.
- Held replies go out whenever the customer writes again, with or without a template, before the new message is answered. The customer's message then runs a normal turn.
- The re-open template is sent once for the first reply held since the customer last wrote, not once per held part.
- Group messages are ignored, not stored.
- The operator registers the webhook in Meta by pasting the callback URL and verify token. Agenta does not call `subscribed_apps`, and disconnecting does not unsubscribe the app, because the same Meta app may serve the business's other tools. Disconnect shows a notice instead.
- The verify token is `<phone_number_id>.<random>` and is kept in the connection data, not the vault, because the operator needs to see it again. The GET handshake finds the connection from the phone number ID in the token.
- Inbound images and documents become session attachments, so the deployment's attachment limits apply (10 MB by default), not Meta's 100 MB.
- Sending files the agent produces is deferred: no channel can return a file from an agent yet.
- A turn already running when the customer sends STOP still delivers its answer.
- A real Meta number has not been tested yet. The code is tested against a fake Graph API that answers like Meta's for every call the adapter makes.

## Adapter mapping

| Interface method | WhatsApp behavior |
| --- | --- |
| `fetch_capabilities` | Static. `spaces.private` only, `controls.update` false, `buttons.max` 10 (the adapter sends reply buttons for up to 3 options and a list for 4 to 10), text `markdown` converted to WhatsApp formatting, `max_chars` 4096, files per D6, no backfill, forwardfill on. |
| `verify_connection` | Read the phone number with the token. Return display name, WhatsApp Business Account ID, and quality rating. |
| `activate_connection` | Not used. The operator registers the webhook in Meta. |
| `connection_locator` | `metadata.phone_number_id` from the body. |
| `verify_signature` | HMAC-SHA256 of the raw body with the connection's app secret (phase 1) or the deployment app secret (phase 2), compared in constant time with `X-Hub-Signature-256`. |
| `parse_event` | One event per `messages[]` item. Statuses update delivery receipts and are not routed. `interactive.button_reply` and `list_reply` become `ACTION` events. Always `private` and `addressed`. |
| `post_message` | `/messages` with text or interactive. Returns `{wa_id, message_id}`. |
| `edit_message` | Not offered. Declared off. |
| `signal_activity` | Typing indicator on the last inbound message ID. |
| `discover_spaces`, `fetch_history` | Return nothing. |
| `revoke_installation` | Returns a notice to remove the callback URL in Meta. |

Ingress adds `GET /channels/whatsapp/events/` for the verify handshake. It looks up the verify token among WhatsApp connections and echoes `hub.challenge` as plain text. `POST /channels/whatsapp/events/` handles events. One webhook body can carry several messages, so `parse_event` is extended to return a list for this adapter, or the ingress splits the body before parsing.

## Regions

Phase 1 needs nothing per region: each customer points their own Meta app at the region's API URL. Phase 2 needs one Meta app per region (EU, US, and staging), as the ops note already requires for hosted Slack and Telegram, because a Meta app has one webhook URL.

## Risks / Trade-offs

- **Policy drift.** Meta decides what "primary functionality" means, and the EU interim measures may change. Mitigation: no shared number, so each business answers for its own number. D9 can be revisited if the EU measures are lifted.
- **Cost surprise after October 1, 2026.** Every reply becomes billable after 1,000 per number per month. Mitigation: the connect screen links Meta pricing, and D3 sends at most one extra message per turn.
- **Pair limit.** Long answers split into many messages can hit error `131056`. Mitigation: 6-second spacing between parts and a retry on that error only.
- **Personal data.** Customer phone numbers and names are stored as sender fields. They need the same retention and deletion handling as other inbox data.
- **Unconfirmed limits.** The 4096 text limit and list field limits are widely cited but not confirmed on a primary Meta page. The implementation reads them from one constant each.
- **Webhook retries.** Meta retries for days if we do not answer quickly. The inbox dedupes on the WhatsApp message ID.

## Effort estimate

| Phase | Scope | Estimate |
| --- | --- | --- |
| 1a | Adapter, capability, ingress GET and POST, signature, paste connect flow, text in and out, typing, splitting | 5 to 7 engineer-days |
| 1b | Service window tracking, held state, re-open template, STOP handling | 3 to 4 engineer-days |
| 1c | Buttons, lists, approvals, images and documents | 3 to 5 engineer-days |
| 1d | Connect card UI, billing notice, docs, live QA with a test number | 3 to 4 engineer-days |
| 2 | Tech Provider onboarding, app review, Embedded Signup per region | 5 to 8 engineer-days, plus 2 to 6 weeks of Meta review time |
| Later | Voice notes, proactive messages with opt-in records, groups | Not estimated |

## Sources

- On-Premises sunset: https://developers.facebook.com/docs/whatsapp/on-premises/sunset
- Phone numbers and registration: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers
- Messaging limits: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- Embedded Signup: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/
- Tech Provider onboarding: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- App review: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- Access tokens: https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/
- Webhooks: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- Reply buttons and lists: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages
- Template categories: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
- Pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Opt-in: https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in
- Groups: https://developers.facebook.com/documentation/business-messaging/whatsapp/groups
- Meta Terms for WhatsApp Business Platform: https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform
- AI provider ban reporting: https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform
- EU interim measures: https://ec.europa.eu/commission/presscorner/detail/en/ip_26_1276
- October 2026 service pricing change: https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026
