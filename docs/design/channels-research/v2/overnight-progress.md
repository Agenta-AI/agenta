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
- [ ] Commit the verified Telegram work on branch channels/telegram; push; open PR (base channels/fix-approval-card-on-park).
- [ ] Codex astra review (ask-codex skill, medium): apply simplify skill first; do NOT change JP's architecture; review added code.
- [ ] Subagent code-quality/cleanliness review of the added code; address findings.
- [ ] Request CodeRabbit review on the PR.
- [ ] Address all review findings (system + subsystem).
- [ ] Lane 3: hosted Telegram bot (Option A) — per-project keying, QR + deep-link account bind, allowed-user-ids gate. Implement + live QA.
- [ ] Media: image support (Telegram + Slack shared) — investigate multimodal session input; implement if tractable, else write a scoped requirements doc. Voice: transcription, scope it.
- [ ] UI (lane 4): read the design via DesignSync (project 11b9bef2-dd9f-495b-a657-8eaf4ea6f07e, file "Agent Channels.dc.html"); implement for the new app (/m) AND desktop; visually test both (browser screenshots).
- [ ] Full test + QA pass with subagents; make production ready.
- [ ] Update decision notes; final morning report.

## Decisions taken tonight (with rationale)
- (record each decision here as it is made)

## Blocked / needs Mahmoud
- Media (image/voice) is cross-cutting multimodal into shared sessions/runner; may need a product/design call.
- Hosted Slack app creation + prod env vars is ops (needs Mahmoud's Slack org).
