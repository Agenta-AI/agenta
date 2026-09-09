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
- [~] Media investigated: the platform HAS image infra (sessions attachments + runner image expansion). Buildable via adapter-download -> attachments-upload -> pass attachment id through the channel invoke. Needs Mahmoud: confirm scope + a vision-capable model (Pi/gpt-5.6-luna vision unconfirmed). Detailed in media-input.md. Voice after images.
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

## Mobile (/m) visual test done (2026-09-09)
- Rendered the first-pass UI on the /m app via a throwaway demo page at a 390px phone viewport,
  screenshotted with chrome-devtools, then reverted (branch pristine).
- The Channels card and the Telegram connect flow render correctly in the /m bottom sheet,
  responsive and on-design. Screenshots: ~/agenta-qa-evidence/2026-09-09-channels-ui/
  (ui-m1-card, ui-m2-telegram-sheet). Both desktop and mobile now visually verified.
- Remaining UI (with Mahmoud): dark mode, the manage/behavior/advanced panel, the Telegram
  link-waiting state, real data wiring, reconcile with existing channels components, Storybook.

## Manage panel + Advanced visually verified (2026-09-09)
- Seeded a connected state and screenshotted the manage panel: the connection summary (Bot,
  Workspace, Connected date), Connected chats with Add channel, the two behavior switches
  (Direct messages, Channels and group chats; Allow/Deny), the Advanced section, and Disconnect.
- Advanced shows the four policy settings in PLAIN language with our chosen defaults: message
  triggers = @mention only, session memory = per thread, read earlier messages = off, read while
  thinking = on. No slugs/ids/revisions/tokens shown. Matches the design and the decisions.
- Screenshots: ui-5-connected-card, ui-6-manage-panel, ui-7-advanced in the evidence dir.
- Only dark mode remains unverified (no simple toggle); a check for Mahmoud. The UI first pass is
  now visually verified across empty/connect/connected/manage/advanced on desktop and mobile.

## CI analysis on PR #6679 (2026-09-09): red is infra + pre-existing, not the Telegram code
- The API unit job reports "10 failed, 4016 passed". All 10 failures are sessions DAO tests
  (test_session_inputs_dao.py, test_late_record_quarantine_dao.py) that fail with
  `socket.gaierror: [Errno -3] Temporary failure in name resolution`. This is a DB/name
  resolution problem in the CI job, not a code defect. It matches memory
  "CI infra name-resolution failures are not the PR".
- The changed test files on this branch are channels and secrets only. None touch sessions DAO,
  so the failures cannot come from the Telegram changes.
- The TypeScript-lint and web-test failures touch no file this branch changed. The branch adds
  NO web/ files, so those are pre-existing standing red on the stacked base. It matches memory
  "Web acceptance CI is standing red — never gate on it".
- The channels unit tests pass locally (874 tests) and are among the 4016 that pass in CI.
- Conclusion: the branch is not the cause of any CI red. Merge on green-elsewhere plus reviews,
  per the standing-red memory.

## PR #6679 merge-readiness re-checked on the current tip (2026-09-09)
- Unresolved review threads: 0.
- Codex astra review: done earlier; all findings fixed.
- CodeRabbit: was skipped (base is a stacked branch). Forced a full review with an
  @coderabbitai comment on the PR; result pending.
- CI red is fully characterised and is NOT this branch:
  - run-api-unit-tests: "10 failed, 4016 passed". Every failure is
    `socket.gaierror: Temporary failure in name resolution` on sessions DAO tests. Infra.
  - run-web-unit-tests: the failures are agenta-chat session-control hook tests
    (useServerSessionInputs, session-cancel-stream) on the stacked base, not channels.
  - The channels tests pass in both jobs: api channels unit, and web
    ChannelSetupCredentialsForm, state/channels/api, AgentaChannelSurface NodeRenderer.
- NOTE found during this check: a Channels settings UI and an AgentaChannelSurface already
  exist on the base branch (web tests reference them). The first-pass UI in
  agenta-settings-ui must be reconciled with these before any UI merge. This needs Mahmoud.
- Conclusion: the custom-bot Telegram PR is code-complete and merge-ready pending Mahmoud's
  lgtm, the CodeRabbit result, and the base branch landing.

## Lane 3 (hosted bind): starting the backend build (2026-09-09)
- Decision: build the hosted-bot backend now, scoped and unit-tested, on a branch stacked on
  channels/telegram. The custom path stays untouched. Live verification is deferred because it
  needs a dedicated hosted bot token that only Mahmoud can create.

## CodeRabbit review addressed on PR #6679 (2026-09-09)
CodeRabbit posted 12 findings: 6 on code, 6 on research docs. Fixed 5 code findings in
commit 3bc293a8f5, with tests, all 855 channels+secrets unit tests green:
- adapter: best-effort typing and callback calls also swallow httpx transport errors.
- mapping: bot-mention match now requires a username boundary (@agenta_bot != @agenta_bot2).
- signature: compare the secret token as bytes, so a non-ASCII header raises 401 not 500.
- secrets: reject a blank secondary credential (empty webhook_secret), like the primary.
- service: re-run activation after a Telegram token rotation (gated on the telegram
  channel, like the webhook-secret mint), so a rotated bot re-points its webhook; raise on
  failure instead of a silent break.
Deferred (1 open thread, flagged for a maintainer): the outbox atomic-claim finding is a
property of JP's shared outbox worker for all channels, not introduced here; the _send
idempotency guard already prevents the observed duplicate. A true concurrent-claim fix
belongs in a separate change to the worker, not this PR.
The 6 doc findings are on planning docs; the security notes are already addressed by the
revised lane-3 plan (webhook secret before write, opaque token, sender-match). All replied
and resolved. Only the deferred outbox thread stays open.

## Live QA regression after the fixes (2026-09-09)
Drove the QA Telegram account (Telethon, ~/.agenta-telegram-qa.env) against the live
channels stack, which hot-reloaded the 5 fixes. Results:
- Direct message: the bot replied "PONG" in ~9s. Exactly ONE reply (no double-answer).
- Conversation memory: a follow-up "what word did I ask you to reply with a moment ago?"
  got "PONG", so thread/session continuity still works across turns.
This confirms the signature-as-bytes change did not break the normal ASCII path, and the
custom-bot happy path, single-delivery, and memory are all intact after the review fixes.
The custom-bot Telegram channel is production-ready and live-verified.

## Production-readiness live QA on the egress paths (2026-09-09)
Extended the live QA to the fragile message-delivery paths, via the QA Telegram account:
- HTML escaping: asked the bot to reply with `< > & <tag> "quotes"`. The message arrived
  verbatim. A broken escape would make Telegram reject the HTML with a 400, so an intact
  arrival proves to_html escaping works live.
- Long-message split: could NOT be triggered live. The QA model (gpt-5.6-luna) will not emit
  a message longer than Telegram's 4096-char limit on request, so the split code path is not
  reachable through the model. It stays covered by the unit test (split-without-corruption).
Live QA coverage on the custom bot is now: happy-path DM, single delivery (no double-answer),
conversation memory across turns, and HTML escaping. The custom-bot Telegram channel is
production-ready and live-verified. Remaining live checks (callback/approval buttons, group
mention) need a group chat or an approval-triggering agent; noted for a later pass.

## Group-chat live QA finding: the bot's privacy mode blocks group messages (2026-09-09)
Tested group chats live with the QA account: created a group, added the bot, and sent a
message that mentions the bot (@newagentabot ...).
- The bot received only the group SERVICE messages (group created, bot added): the ingress
  logged two events per test, both with EMPTY text and addressed=false, message ids that do
  NOT match the mention message id I sent (Telethon sent msg 206; the bot saw 106/107).
- The bot never received the user's @mention text message, so it never answered in the group.
Cause: the bot's group privacy mode is ON (BotFather default). With privacy on, Telegram does
not deliver ordinary group messages to the bot. This is a per-bot BotFather setting
(/setprivacy -> Disable), on the bot owner's Telegram account, not a code defect. My
mention-boundary fix is correct (the regex matches the stored username; verified in isolation).
Implications for group support in v1:
- The setup flow must tell the user to disable group privacy in BotFather for group use, OR
  we accept that a hosted/custom bot only answers @mentions/commands/replies in groups (which
  privacy mode still delivers, but the delivery of the plain @mention needs to be confirmed).
- After privacy is disabled, re-test that a group @mention opens a turn (the effective policy
  must include MENTION triggers for the group space).
DM (private chat) is fully working and live-verified; this finding is specific to groups.

## Group code path confirmed correct (2026-09-09)
Checked the default policy (`_channel_defaults` in service.py): it includes MENTION, COMMAND,
and ACTION triggers. So once the bot RECEIVES a group message that mentions it, `_is_trigger`
returns true (MENTION in triggers + addressed) and a turn opens. The group code path is
correct by default; no code fix is needed. The sole blocker for groups is the bot's BotFather
group-privacy setting, which stops Telegram from delivering group messages to the bot. This is
external bot config on the owner's account, not a code change.

## Status: autonomous work is complete; all remaining items need Mahmoud
- Custom-bot DM: built, Codex + CodeRabbit reviewed, fixed, unit-tested (855), live-verified
  (happy path, single delivery, memory, HTML escaping). PR #6679 ready; one open thread is the
  deferred outbox concurrency finding (awaiting Option 1/2).
- Groups: code correct; needs the bot's group privacy disabled in BotFather to finish live QA.
- Hosted bot (lane 3): plan revised per Codex, build-ready; needs a token + two confirmations.
- Images/voice: needs a scope decision + a vision-capable model.
- UI: first pass built + visually verified; needs reconciliation with the existing Channels
  settings UI, real-data wiring, dark mode, and Storybook (needs Mahmoud's taste + data layer).

## Lane 3 build started (2026-09-09, after Mahmoud's go-ahead)
Mahmoud confirmed: one shared hosted bot configured via an env var (TELEGRAM_HOSTED_BOT_TOKEN),
reuse the existing test bot for staging for now, and the UI picks the default agent before the
link is generated. Images are out of scope this release.
Built on branch channels/telegram-hosted (stacked on channels/telegram):
- core/channels/telegram_binding.py: the TelegramBindingService (issue_bind_link,
  consume_bind_token, resolve_bound_connection) with an injected TelegramBindingStore
  Protocol. Opaque token (token_urlsafe, <=64 chars for Telegram's deep-link cap), 30-min TTL,
  one-time consume, one-chat-one-project rule, replay-idempotent on the same project, atomic
  consume+bind+account-link in the store. 8 unit tests, all green.
Next increments: the Postgres binding table + DAO + migration; the HostedTelegramAdapter
(channel key telegram_hosted, fixed ["project"] identity, shared transport); the ingress
hosted-resolve branch; the bind-start router endpoint; env.py TELEGRAM_HOSTED_BOT_TOKEN.
Live verification waits on the staging bot being pointed at the hosted webhook.

## Lane 3 increment 2 (2026-09-09): env config + hosted capabilities
- env.py: ChannelsTelegramConfig reads TELEGRAM_HOSTED_BOT_TOKEN and
  TELEGRAM_HOSTED_WEBHOOK_SECRET; `enabled` is true only when both are set; exposed at
  env.channels.telegram (mirrors env.channels.slack). Verified the import in the container.
- adapters/telegram_hosted/capabilities.py: identity keys on ["project"], space/thread still
  on the chat, rendering/fill/addressing identical to the custom bot, no paste-a-token setup.
- Tests: hosted capability shape + env enabled-gating. 44 telegram unit tests green.
Remaining lane-3 slice (built together, their contract is interdependent, then live-tested):
the Postgres binding table + DAO (atomic consume+bind+account-link using compose_external_user_key
with chat_id, matching the inbox worker), the HostedTelegramAdapter (deployment-token egress,
deployment-secret verify_signature returning the project, no-op activation), the ingress
hosted-resolve branch, and the bind-start router endpoint. Live verification needs the staging
bot pointed at the hosted webhook (needs the bot's group privacy off and the custom connection
removed first).

## Group live QA PASSED (2026-09-09, after Mahmoud disabled group privacy)
Created a group, added the bot. A plain message got no reply; an @mention got "GROUPOK" in
~10s. Groups work end to end for the custom bot. Decision taken: keep QR in the hosted flow
from the start (Mahmoud), and Option 1 for groups (setup tells users to disable group privacy).

## Lane 3 increment 3 (2026-09-09): bind persistence, applied + smoke-tested live
- Binding service now composes the account key from the hosted capabilities (chat id scope,
  sender user), matching the inbox worker, and hands the store a ready key. 8 tests.
- Tables: channel_telegram_bind_tokens, channel_telegram_chat_bindings (migration
  oss000000030, applied to the channels stack DB). Globally keyed (looked up without a project).
- TelegramBindingDAO: atomic consume_token_and_bind (guarded token consume + chat binding +
  account link, all one transaction, concurrent-safe via ON CONFLICT).
- Smoke-tested end to end against Postgres: issue, consume+bind, account link with the worker
  key, resolve, replay idempotency, conflicting-project refusal. 763 channels unit tests green.
Remaining lane-3 slice: HostedTelegramAdapter (deployment-token egress, deployment-secret
verify returning project, no-op activation), ingress hosted-resolve branch, the bind-start
router endpoint (returns the deep link + a QR), and wiring the binding service in the app.
Then repoint the staging bot at the hosted webhook and live-test /start end to end.

## Lane 3 hosted bot: LIVE END-TO-END TEST PASSED (2026-09-09)
Completed the hosted slice (adapter, ingress hosted-resolve branch, bind-link endpoint,
ensure-connection, wiring) and live-tested the whole tap-to-connect flow on the channels stack:
- Configured the deployment env (test bot as the hosted bot) via the stack's local override:
  TELEGRAM_HOSTED_BOT_TOKEN/WEBHOOK_SECRET/BOT_USERNAME; recreated api + both workers.
- Pointed the bot webhook at /api/channels/telegram/events/<bot_id>/ with the deployment secret.
- Created the hosted connection + agent for the QA project and minted a bind link.
- Drove it from the QA Telegram account: "/start <token>" -> "You are connected." in 0.3s;
  then a question -> the agent replied "HOSTEDOK" in 9s.
- DB verified: chat binding row (bot, chat, project, connection), token consumed, and the
  account identity link with the worker-matching key attributing the invoking user (the link
  creator), so the agent answered as that user, not the agent owner.
QR: the bind-link endpoint returns the deep-link url and expiry; the UI renders the QR from the
url client-side (no backend QR dependency). Kept QR from the start per Mahmoud.
The hosted bot is code-complete, unit-tested (871 channels+secrets), persistence proven against
Postgres, and live-verified end to end. Branch channels/telegram-hosted.
Note: this dev stack now runs the test bot as the hosted bot (local override, gitignored). The
custom-bot PR #6679 is independent and already verified/merge-ready.

## Hosted bot reviews addressed (2026-09-09)
Codex (gpt-astra, xhigh) reviewed the hosted CODE and found two P1s and several P2/P3s; it even
reproduced a cross-project race against Postgres. All fixed in commit 4e86104f18:
- P1 group sender -> hosted flow drops non-private chats (v1 private-only; exact attribution).
- P1 concurrent-bind race -> consume_token_and_bind validates binding ownership inside the
  transaction and rolls back the loser; expiry added to the consume predicate. Re-proven against
  Postgres under true concurrency: one wins, one refused, one binding, one link, one token used.
- P2 fresh-link replay -> a fresh token on an already-connected chat is refused
  (ChatAlreadyConnected), not a phantom success; a consumed token stays idempotent.
- P2 reconnect -> ensure reuses and unarchives an archived hosted connection.
- P2 username -> enabled requires a username; adapter strips a leading @.
- P3 -> /start parser no longer crashes on whitespace.
- simplify -> custom ingest path reuses _record_and_enqueue.
CodeRabbit posted 4 findings on the PR; all addressed (the DTOs moved to models.py in
e7ca80edf7; the other 3 were the same items Codex raised). All PR threads resolved.
Live re-verified after the fixes: the bound chat still answers ("STILLWORKS", ~8s). 875
channels+secrets unit tests pass. PR #6724 is reviewed, tested, and live-verified.
Known v1 limits (documented, accepted): hosted is private chats only; a chat cannot be rebound
to a different project until its binding is released (disconnect binding cleanup is a follow-up).

## CI caught a real (env-dependent) test bug on the hosted PR (2026-09-09)
run-api-unit-tests on #6724 failed on one of my tests: test_telegram_hosted_env
test_enabled_needs_both_token_and_secret asserted that token+secret alone is "enabled".
That contradicts the new username requirement, but it PASSED locally because the dev
container has TELEGRAM_HOSTED_BOT_USERNAME set (from live testing), so the config's username
defaulted to a truthy value and masked it. CI has no such var, so it failed. Fixed in
e0a0f0361d: every hosted-config test now passes bot_token, webhook_secret, and bot_username
explicitly, so the result does not depend on the ambient environment. Verified by running the
suite with the three vars unset (simulating CI): 771 channels tests pass. The remaining
api-unit reds are the known socket.gaierror infra flake on unrelated session DAO tests.
Lesson: config tests must set every field explicitly; the dev container's env can hide a CI gap.
