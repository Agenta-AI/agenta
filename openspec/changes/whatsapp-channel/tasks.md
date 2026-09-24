# Tasks

These tasks describe future implementation. All remain unchecked. The behavior choices are recommendations awaiting Mahmoud's review.

## 1. Adapter and ingress (phase 1a)

- [ ] 1.1 Add the `whatsapp` capability declaration: private spaces only, no edits, 3 buttons, list limit 10, 4096-character text, no backfill; verify normalisation tests.
- [ ] 1.2 Add a capability flag for a native-only turn indicator and make the outbox skip the placeholder text when it is set; verify Slack and Telegram outbox suites are unchanged.
- [ ] 1.3 Implement `verify_connection` (read the phone number), `activate_connection` (subscribe the app), and `revoke_installation` (unsubscribe); verify with recorded Graph API responses.
- [ ] 1.4 Add `GET` and `POST /channels/whatsapp/events/`, the verify-token lookup, and the `X-Hub-Signature-256` check; verify valid, forged, missing, and unknown-token cases.
- [ ] 1.5 Implement `parse_event` for text, interactive replies, statuses, and multi-message bodies; verify dedupe on the WhatsApp message ID.
- [ ] 1.6 Implement `post_message` with splitting and 6-second spacing, and `signal_activity` with the typing indicator on the last inbound message ID; verify the pair-limit retry.

## 2. Service window and consent (phase 1b)

- [ ] 2.1 Store the last inbound time per space and check the window before each free-form post.
- [ ] 2.2 Add the `held` delivery state with `window_closed`, show it in the session, and map error `131047` to it.
- [ ] 2.3 Add the optional re-open template on the connection and deliver held replies after the customer answers.
- [ ] 2.4 Handle STOP, UNSUBSCRIBE, and START; verify no turn or template is sent while opted out.
- [ ] 2.5 Refuse WhatsApp sends to numbers that never wrote to the business.

## 3. Choices and media (phase 1c)

- [ ] 3.1 Render choices as reply buttons, list messages, or numbered text by option count; verify stale taps are ignored.
- [ ] 3.2 Download inbound images and documents and pass them to the agent; send agent-produced images and documents.
- [ ] 3.3 Reply once to audio, video, and sticker messages; replace oversize files with a notice.

## 4. Connect experience and docs (phase 1d)

- [ ] 4.1 Build the WhatsApp connect card with the paste form, webhook URL, verify token, billing notice, and policy confirmation.
- [ ] 4.2 Write the user guide for creating a system user, token, and webhook in Meta.
- [ ] 4.3 Run live QA with a Meta test number: text, long answer, approval buttons, PDF in, window closed, STOP.

## 5. Embedded Signup (phase 2)

- [ ] 5.1 Complete business verification and Tech Provider onboarding for Agenta's Meta business, one app per region.
- [ ] 5.2 Pass app review for `whatsapp_business_management` and `whatsapp_business_messaging`.
- [ ] 5.3 Add the Embedded Signup popup and server-side code exchange; verify the resulting connection matches a bring-your-own connection.
- [ ] 5.4 Document the per-region Meta app setup in the hosted operations runbook.
