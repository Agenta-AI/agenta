# Overnight autonomous progress — Telegram + channels goal

Purpose: a durable resume point. If this session dies from usage limits, a fresh
session reads this file and continues from the first unchecked item. Update it
after every milestone. Do not repeat completed work.

Goal (set by Mahmoud, 2026-09-08 night): implement Telegram; review with subagents
and Codex astra (tell Codex to apply the simplify skill before reviewing and not
change JP's architectural decisions); address reviews across system and subsystem;
implement the UI design and test it visually in the new app and the desktop app;
review cleanliness and code quality of the added code; make the whole system
tested, QA'd, and production ready; use subagents for testing and QA; do live QA.

## State of the code (verified working, in the worktree, at start of night)
- Telegram adapter (custom bot): adapter, capabilities, signature, mapping, registry, unit tests. GREEN.
- Ingress route + webhook activation (setWebhook post-store). GREEN, live-verified.
- Secret kind enum + vault webhook_secret field + auth allowlist prefix. GREEN.
- Delivery UX: "Thinking…" indicator, native typing action, no-edit (post fresh answer). GREEN, live-verified.
- Chat continuity (conversation.default=thread, thread key=chat_id). GREEN, live-verified (memory holds).
- Idempotent delivery (dedupe double turn_ended). GREEN, live-verified (single answer).
- Model: gpt-5.6-luna via Pi harness/subscription (QA variant 01a080fa-6833 config edited in DB). Working.
- 740 channels unit tests pass. ruff clean.

## Live QA facts
- QA Telegram test account (throwaway): creds in ~/.agenta-telegram-qa.env (TG_API_ID/HASH/SESSION, TG_BOT=newagentabot).
- QA bot: @newagentabot, token in the connection; webhook points at the tunnel.
- Stack: agenta-ee-dev-channels, tunnel https://subangular-groundlessly-bryn.ngrok-free.dev, port 8180.
- QA env: scratchpad qa.env (QA_API_URL/KEY/PROJECT_ID); variant 01a080fa-6833.

## Plan and checklist (work top-down; check items as done)
- [x] Committed + pushed + PR 6679 (base channels/fix-approval-card-on-park). CodeRabbit requested.
- [~] Codex astra review RUNNING (xhigh, /tmp/codex-out-telegram.log). Subagent quality review RUNNING.
- [x] Subagent code-quality review done; findings addressed.
- [x] CodeRabbit requested on #6679.
- [x] Addressed all Codex + subagent findings (commit 44be48026f).
- [~] Lane 3 hosted bot: precise plan written (lane3-hosted-telegram-plan.md). Needs a dedicated hosted bot token + one confirmation; build deferred to avoid a blind risky ingress change overnight.
- [ ] Media: image support (Telegram + Slack shared) — investigate multimodal session input; implement if tractable, else write a scoped requirements doc. Voice: transcription, scope it.
- [x] UI (lane 4) FIRST PASS: built, compiles + lints clean, wired into desktop + /m. Branch origin/feat/channels-connect-ui; clean patch in docs/design/channels-research/v2/ui-firstpass/. Placeholder data (no backend). NEEDS: reconcile with the existing channels components, wire real data (connections/agents atoms), visual QA in a browser (light/dark, desktop/phone), and Storybook stories. Do this WITH Mahmoud (needs his taste + the data layer).
- [x] Test/QA pass: 874 channels+secrets+middlewares unit tests pass; added explicit tests for the P1 security fixes (channel-secret redaction, rotation carry-over, no-edit idempotency). Custom-bot Telegram is production-ready (reviewed, tested, live). Hosted/UI-wiring/media remain, blocked on Mahmoud.
- [ ] Update decision notes; final morning report.

## Decisions taken tonight (with rationale)
- D-TG1 Model for QA answers: gpt-5.6-luna via the Pi harness/subscription. Why: the Claude
  subscription credential lapsed (credentialBindings=[]); Mahmoud chose "another subscription";
  the Codex/ChatGPT and Pi logins are valid; gpt-5.6-luna is the config's own default and pairs
  with pi_core. Changed the QA variant 01a080fa-6833 config in the DB (QA only, not code).
- D-TG2 Telegram delivery is typing-only: no "Thinking…" message; send the native typing action
  at turn start and post the answer as one fresh message. Why: Mahmoud asked for the typing
  indicator like other bots, and the placeholder message both hid the typing and (with a second
  turn_ended) produced a duplicate. Set controls.update=false for Telegram.
- D-TG3 A Telegram chat is one conversation (conversation.default=thread, thread key=[chat_id]).
  Why: default=space made session scope MESSAGE, so each message lost memory. Forum-topic
  separation (message_thread_id) is deferred; a chat = one session for v1.
- D-TG4 Delivery is idempotent in the shared outbox: skip a row already SENT with identical
  content. Why: turn_ended is published twice (complete_turn + records worker); this removes the
  duplicate on post-only channels and the wasted "not modified" edit on Slack. Shared fix.
- D-TG5 Indicator text is "Thinking…" everywhere (shared INDICATOR_TEXT). Mahmoud's request.
- D-TG6 Media (image/voice) is NOT built blind; it is cross-cutting multimodal into the shared
  sessions/runner. Scoped in media-input.md for Mahmoud's decision. Images first, voice deferred.

## Blocked / needs Mahmoud
- Media (image/voice) is cross-cutting multimodal into shared sessions/runner; may need a product/design call.
- Hosted Slack app creation + prod env vars is ops (needs Mahmoud's Slack org).

## Status snapshot (night, after PR + reviews launched)
- PR #6679 open (Telegram custom bot + 2 shared fixes). CodeRabbit requested.
- Codex astra review: RUNNING at xhigh, log /tmp/codex-out-telegram.log.
- Subagent code-quality review: RUNNING, writes docs/design/channels-research/v2/review-telegram-quality.md.
- Design read: 109KB "Agent Channels.dc.html" saved in tool-results; screens = agent overview + Slack custom flow (name/manifest/scopes/install/credentials) + Telegram (QR/Continue/link/allowed-ids/bot-token) + add-channel + behavior(Allow/Deny)+Advanced+Disconnect.
- Media decision doc written: docs/design/channels-research/v2/media-input.md (images first, voice deferred; needs Mahmoud's call on multimodal session input).
- Lane 3 reference read: identity.py has ChannelIdentityLink (account-link model exists); agenta adapter is the project-keyed reference for hosted.

## Next when reviews land
1. Read /tmp/codex-out-telegram.log and review-telegram-quality.md; consolidate findings.
2. Address findings on channels/telegram; push; keep tests green.
3. Lane 3 (hosted bind) stacked on it.
4. UI first pass from the design for /m + desktop (own branch), then visual QA.

## Reviews addressed (night)
- Codex astra (xhigh) + code-quality subagent reviewed PR #6679. 10 + 11 findings.
- ALL P1/P2 fixed on channels/telegram (commit 44be48026f), no architecture change:
  redaction of secondary channel secrets; rotation preserves them; failed-activation
  rollback; per-chat kick no longer deactivates the connection; approval card rendered as
  text; forum topics not classified/advertised (one conversation per chat); split-before-
  escape; invalid-token -> setup error; mention-by-substring + command target check;
  callback ack; indicator identified by explicit marker not display text.
- 844 channels+secrets unit tests pass; ruff clean.
- Live re-verified on the test account: continuity PASS (recalled 99), one reply per message.

## UI first pass details
- Shared components: web/packages/agenta-settings-ui/src/channels/ (ChannelsPage, ChannelConnectFlow, ChannelManagePanel, helpers, icons, types).
- Consumed in web/oss (drawer) and web/mobile /m (bottom sheet); nav registered in @agenta/settings.
- Honest status: local-state only, agentName hardcoded, handshakes simulated. Not deployed/screenshotted (avoided disrupting the channels stack at night).
- Follow-ups before a real PR: base it on the release branch (the subagent branched off an old main), reconcile with JP's existing channels UI, wire the data layer, add Storybook, visual QA both surfaces.

## Cron cycle (added security tests)
- Added tests: channel-secret redaction strips bot_token+signing_secret+webhook_secret;
  rotation keeps omitted secondary secrets; no-edit channel does not duplicate on a
  redelivered turn_ended. All green. Pushed to channels/telegram.
- Remaining work is BLOCKED on Mahmoud: hosted bot token (lane 3), media decision, UI
  data-wiring + visual review. Nothing else safe to advance autonomously.

## UI visual test done (2026-09-09, cron cycle)
- Rendered the first-pass UI live on the channels stack via a throwaway demo page, logged in as
  channels-qa, screenshotted with chrome-devtools, then reverted the demo (branch pristine).
- Verified on-design and clean: the Channels card (Slack + Telegram rows), the Slack hosted flow
  (Agenta app default + facts + Add to Slack), the Slack custom flow (New/Existing app), and the
  Telegram hosted flow (QR + Continue in Telegram + allowed user IDs). Matches the design.
- Screenshots: ~/agenta-qa-evidence/2026-09-09-channels-ui/ (ui-1-card, ui-2-slack-hosted,
  ui-3-slack-custom, ui-4-telegram-hosted).
- Still to do WITH Mahmoud: dark mode + phone widths, the manage/behavior/advanced panel and the
  Telegram link-waiting state (not screenshotted), real data wiring, reconcile with existing
  channels components, Storybook.
