# Proposal

## Why

Many businesses talk to their customers on WhatsApp, not Slack or Telegram. Today an Agenta agent can answer in Slack and Telegram, but a business cannot put the same agent behind its WhatsApp number.

Status: Approved by Mahmoud on 2026-09-24, with D9 changed to option B (no Agenta-added policy rules). Each decision lists its alternatives in [design.md](design.md).

## What Changes

- Add WhatsApp as a third Channels platform, next to Slack and Telegram. A connection is one WhatsApp business phone number on Meta's Cloud API.
- Phase 1: the customer brings their own number. They paste the phone number ID, a permanent system-user access token, and their Meta app secret. Agenta generates the webhook URL and verify token for them to paste into Meta.
- Phase 2: Agenta becomes a Meta Tech Provider and offers Embedded Signup, so a customer connects their number in a Meta popup. Agenta never offers one shared Agenta-owned WhatsApp number.
- The customer's business pays Meta directly on both paths. Agenta never extends a Meta credit line.
- Conversations are one-to-one only. Each customer phone number is one conversation with the agent. Groups are out of scope.
- Agenta respects Meta's 24-hour customer service window. A reply that would go out after the window closed is held, the run is marked "window closed", and nothing is sent unless the operator configured a re-open template.
- Long turns show the native typing indicator, refreshed every 20 seconds. If the turn runs past 30 seconds, the agent sends one short "working on it" message. The final answer goes out as new messages, split at 4096 characters. WhatsApp cannot edit sent messages, so there is no in-place progress.
- Approval and choice prompts use reply buttons for up to 3 options, a list message for up to 10, and a numbered text prompt beyond that. Typed answers keep working.
- Images and documents the customer sends reach the agent. Sending files back comes later, once an agent can return a file on any channel. Voice notes, video and stickers get a fixed reply.
- v1 only answers conversations the customer started. It sends no business-initiated messages. A customer who sends STOP is not answered again until they send START.
- Agenta adds no rules of its own about what kind of agent runs on a WhatsApp number: no restriction, no confirmation checkbox, and no forced wording in the connect flow or in Agenta's terms. Each business is responsible for its own use of WhatsApp under Meta's terms.

## Capabilities

### New Capabilities

- `whatsapp-connection`: Connecting a WhatsApp business number (bring your own, then Embedded Signup), webhook verification, signature checks, and disconnect.
- `whatsapp-conversation`: One-to-one conversations, typing and progress behavior, message splitting, approvals and choices, media, and delivery status.
- `whatsapp-service-window`: Tracking the 24-hour customer service window, holding replies after it closes, optional re-open templates, opt-out, and inbound-only messaging.

### Modified Capabilities

None. WhatsApp adds a new adapter. The shared Channels routing, inbox, and outbox keep their current behavior for Slack and Telegram.

## Impact

Backend: a new `whatsapp` adapter under `api/oss/src/core/channels/adapters/`, its capability declaration, two ingress routes (a GET for Meta's verify handshake and a POST for events), a service-window check in the outbox, a new held delivery state, and a native-only turn indicator. Frontend: a WhatsApp connect card with the paste form, the webhook details, and the billing notice. Phase 2 adds Meta Tech Provider onboarding, app review, and an Embedded Signup callback.

No change to Slack or Telegram behavior. No Agenta-owned WhatsApp number, no Meta credit line, no groups, and no business-initiated or marketing messages in this change.
