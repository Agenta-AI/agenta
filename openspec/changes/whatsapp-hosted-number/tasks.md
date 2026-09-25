# Tasks

Draft for Mahmoud's review. Nothing is implemented. The step-by-step version, with tests and commands, is [plan.md](plan.md).

## 1. Shared hosted bind (phase 1)

- [ ] 1.1 Add migration `oss000000037`: a `channel` column (default `telegram_hosted`) on both hosted bind tables, and the binding unique key on `(channel, bot_id, chat_id)`.
- [ ] 1.2 Generalize `TelegramBindingService` into `HostedBindingService` with a channel, a code format and a link builder; check the token's channel on consume.
- [ ] 1.3 Keep every hosted Telegram test green with no behavior change.

## 2. Hosted adapter and ingress (phase 2)

- [ ] 2.1 Make the `WhatsAppAdapter` number, token and app secret overridable methods.
- [ ] 2.2 Add `WHATSAPP_HOSTED_CAPABILITIES`, `HostedWhatsAppAdapter`, and `env.channels.whatsapp.hosted`.
- [ ] 2.3 Add the 12-character code, its prefilled message, and the forgiving code extractor.
- [ ] 2.4 Add the hosted branch to the WhatsApp GET handshake and POST ingress: verify, bind by code, route by binding, stay silent to strangers.

## 3. Routes and the daily cap (phase 3)

- [ ] 3.1 Generalize `ensure_hosted_telegram_connection` into `ensure_hosted_connection(channel=...)`.
- [ ] 3.2 Add `POST /catalog/channels/whatsapp_hosted/bind-link/` and `GET /catalog/channels/whatsapp_hosted/bindings/`; release bindings on disconnect.
- [ ] 3.3 Add `conversation.daily_message_cap` and enforce it in the outbox with the one-time notice.
- [ ] 3.4 Use the `agenta_reply_ready` template for hosted held replies.
- [ ] 3.5 Regenerate the Fern client from an EE spec.

## 4. Connect card (phase 4)

- [ ] 4.1 Add `connectHostedWhatsApp` and `countHostedWhatsAppBindings` to the channel actions.
- [ ] 4.2 Add the hosted tab to the WhatsApp card, reusing the Telegram hosted steps, with the daily limit line.

## 5. Operations, docs and live QA (phase 5)

- [ ] 5.1 Meta setup per deployment: number, display name, profile, template, webhook override, env vars.
- [ ] 5.2 Docs: user guide section and self-host page for the hosted number.
- [ ] 5.3 Live QA through the UI on a real number.
