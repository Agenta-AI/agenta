# Proposal: Agenta's hosted WhatsApp number

## Why

Bring-your-own WhatsApp (PR #7132, branch `feat/whatsapp-channel`) works, and Mahmoud tested it live. But it asks a user to create a Meta app, a WhatsApp Business Account, a system user and a permanent token before their agent can answer a single message. That setup takes 20 to 40 minutes in Meta Business Manager. Most people who want to talk to their own agent from their phone will stop there.

Telegram solved the same problem with one Agenta-owned bot per deployment. The user clicks Connect, scans a QR code, taps Start, and talks to the agent. Mahmoud's research found that Meta's rules allow the same shape on WhatsApp: one Agenta WhatsApp number per deployment, which users connect to their agents with no WhatsApp Business account of their own.

Status: draft for Mahmoud's review. Nothing is implemented.

## What changes

- Each deployment (EU, US, staging) gets one Agenta-owned WhatsApp number. A new `whatsapp_hosted` channel serves it, next to the existing `whatsapp` channel, the way `telegram_hosted` sits next to `telegram`.
- The WhatsApp connect card offers "Use Agenta's WhatsApp" next to "Use your own number". The hosted tab shows a QR code and an "Open WhatsApp" button for a `https://wa.me/<number>?text=<message>` link. The prefilled message is friendly text that carries a short one-time code, for example `Hi Agenta! Connect my WhatsApp. Code: K7QM-4XRT-9BDA`.
- The user sends that message. Agenta matches the code, binds that phone to the project's hosted connection, and replies "You are connected. Send a message and your agent will reply." The card polls and flips to Connected, exactly as on Telegram.
- Binding, routing, switching agents, and unbinding follow hosted Telegram one to one: a phone belongs to one project at a time, a project's hosted connection answers with one agent, connecting another agent retargets it, and disconnecting in Agenta frees every bound phone.
- Messages from phones that never bound get no reply, as on Telegram. The one exception is a message that carries a code-shaped string which is not a valid code: it gets the same "link is not valid anymore" reply Telegram gives a bad `/start`.
- Agenta pays Meta for the hosted number. A per-project daily cap on outbound messages (default 100 per rolling 24 hours) bounds that cost and the damage one project can do to the shared number's quality rating. The card states the limit.
- The 24-hour window rules, held replies, STOP and START, buttons, typing, splitting, and error handling come from the bring-your-own adapter unchanged. The hosted number registers one re-open template of its own.
- The hosted bind reuses the hosted Telegram bind tables and service. A migration adds a `channel` column to both tables. No new tables.

This reverses one line of the approved `whatsapp-channel` design. Its decision D1 said "Agenta never offers one shared Agenta-owned WhatsApp number." This change replaces that line for the hosted path only. Bring-your-own stays the path for a business that wants its customers to see its own name and number.

## Base branch

This change builds on the code in PR #7132, so the branch `docs/whatsapp-hosted-number` is based on `feat/whatsapp-channel` (head `6392c62904`). The hosted adapter subclasses that PR's `WhatsAppAdapter`, and the plan assumes its migration `oss000000036` is the head.

## Capabilities

### New capabilities

- `whatsapp-hosted-connection`: connecting a phone to an agent through Agenta's number (bind link, code matching, confirmation, routing, switching, unbinding, unknown senders, the connect card).
- `whatsapp-hosted-limits`: running one shared number safely (deployment configuration, webhook, the per-project daily cap, the re-open template, and the kill switch).

### Modified capabilities

None. The bring-your-own `whatsapp` channel and the hosted Telegram bot keep their behavior. The shared bind service gains a channel parameter and the tables gain a column; hosted Telegram behaves the same after the change.

## Impact

- **Backend:** a `whatsapp_hosted` adapter that subclasses `WhatsAppAdapter` and reads its number, token and app secret from the deployment env; a hosted branch in the existing WhatsApp GET and POST ingress routes; two catalog routes (`/catalog/channels/whatsapp_hosted/bind-link/` and `/bindings/`); a channel-agnostic hosted bind service; migration `oss000000037`; a `conversation.daily_message_cap` capability that the outbox enforces; five env vars.
- **Frontend:** the hosted tab on the WhatsApp card, reusing the Telegram hosted QR, wait and expiry states.
- **Operations:** Agenta's Meta business portfolio needs business verification, one number per deployment with an approved display name, one approved utility template, and the webhook set once in the Meta app.
- **Not included:** groups, business-initiated messages, a per-phone unbind from the phone, a routing front door across regions, and billing users for WhatsApp messages.
