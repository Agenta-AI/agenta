# Tasks

Mahmoud approved these decisions on 2026-09-24. Phase 1 is implemented on `feat/whatsapp-channel`; phase 2 (Embedded Signup) is not.

## 1. Adapter and ingress (phase 1a)

- [x] 1.1 Add the `whatsapp` capability declaration: private spaces only, no edits, buttons up to 10 (reply buttons for 3, a list for 4 to 10), 4096-character text, no backfill; verify normalisation tests.
- [x] 1.2 Add a capability flag for a native-only turn indicator and make the outbox skip the placeholder text when it is set; verify Slack and Telegram outbox suites are unchanged.
- [x] 1.3 Implement `verify_connection` (read the phone number) and `revoke_installation` (a notice to remove the callback URL in Meta; see "As built" in design.md for why Agenta does not subscribe or unsubscribe the app); verify against the fake Graph API.
- [x] 1.4 Add `GET` and `POST /channels/whatsapp/events/`, the verify-token lookup, and the `X-Hub-Signature-256` check; verify valid, forged, missing, and unknown-token cases.
- [x] 1.5 Implement `parse_event` for text, interactive replies, statuses, and multi-message bodies; verify dedupe on the WhatsApp message ID.
- [x] 1.6 Implement `post_message` with splitting and a retry on the pair rate limit, and `signal_activity` with the typing indicator on the last inbound message ID.

## 2. Service window and consent (phase 1b)

- [x] 2.1 Check the window before each free-form post, from the space's latest inbound message (no new stored field).
- [x] 2.2 Add the `held` delivery state with `window_closed`, show it in the outbox events, and map error `131047` to it.
- [x] 2.3 Add the optional re-open template on the connection and deliver held replies after the customer answers.
- [x] 2.4 Handle STOP, UNSUBSCRIBE, and START; verify no turn or template is sent while opted out.
- [x] 2.5 Refuse WhatsApp sends to numbers that never wrote to the business (a thread with no inbound message is outside the window).

## 3. Choices and media (phase 1c)

- [x] 3.1 Render choices as reply buttons, list messages, or numbered text by option count; verify stale taps are ignored.
- [x] 3.2 Download inbound images and documents and pass them to the agent as session attachments.
- [ ] 3.2b Send agent-produced images and documents. Deferred: no channel can return a file from an agent yet.
- [x] 3.3 Reply once to audio, video, and sticker messages; replace oversize files with a notice.

## 4. Connect experience and docs (phase 1d)

- [x] 4.1 Build the WhatsApp connect card with the paste form, webhook URL, verify token, and billing notice (no policy confirmation, per D9).
- [x] 4.2 Write the user guide for creating a system user, token, and webhook in Meta.
- [x] 4.3a Run end-to-end QA on a local stack against a fake Graph API: text, long answer, approval buttons, a document in, window closed, STOP.
- [ ] 4.3b Run live QA with a real Meta test number. Needs a Meta app and number.

## 5. Embedded Signup (phase 2)

- [ ] 5.1 Complete business verification and Tech Provider onboarding for Agenta's Meta business, one app per region.
- [ ] 5.2 Pass app review for `whatsapp_business_management` and `whatsapp_business_messaging`.
- [ ] 5.3 Add the Embedded Signup popup and server-side code exchange; verify the resulting connection matches a bring-your-own connection.
- [ ] 5.4 Document the per-region Meta app setup in the hosted operations runbook.
