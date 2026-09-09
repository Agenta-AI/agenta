# Channels (Slack + Telegram) — project status

The single source of truth for this project's state. Updated after every
milestone. Read this first. If a detail lives in another doc, this file links to
it; this file stays the map.

Last updated: 2026-09-09.

## Goal (Mahmoud, /goal "the working thing as discussed")
A working deployment where Slack and Telegram both work end to end, reviewed,
QA'd, live-QA'd for new work, UI-QA'd, and with Codex (gpt-astra) feedback. Do
not redo what is already done. PRs ready but NOT merged.

## Exit condition
From the running stack, a user opens the AGENT PAGE, connects the agent to
Telegram (and Slack), and the agent answers in the chat. The connect screen is
the new design. The old technical screen stays in Settings until a new version
replaces it. Everything reviewed (Codex + CodeRabbit), unit-tested, and
live-verified end to end through the UI, on desktop and /m, light and dark.

## Decisions (Mahmoud)
- NEW designed connect screens live on the AGENT PAGE. The OLD technical screens
  stay in the Settings page for now, untouched, until a new version replaces them.
- Testing reuses ONE bot for everything (the QA test bot @newagentabot); do not
  fuss about separate bots for custom vs hosted vs Slack.
- PRs ready but NOT merged.
- Images and voice are OUT of scope this release; when built, upload via the
  attachments store like the web UI (see media-input.md).
- Hosted Telegram is private chats only for v1.

## Work packages and status
Legend: [x] done+verified  [~] in progress  [ ] not started

Backend — Telegram:
- [x] Custom Telegram bot: adapter, ingress, activation. PR #6679. Reviewed
  (Codex + CodeRabbit), unit-tested (874+), live-verified (DM, groups, memory,
  escaping). Merge-ready, NOT merged.
- [x] Hosted Telegram bot: bind service, DAO + tables (migration oss000000030),
  hosted adapter, ingress hosted-resolve, bind-link endpoint. PR #6724 (stacked
  on #6679). Reviewed (Codex + CodeRabbit, all addressed), unit-tested,
  live-verified end to end. Merge-ready, NOT merged.
- [~] Disconnect frees the chat binding so a chat can reconnect (incl. to a
  different project). Codex P2. NEXT ITEM.

Backend — Slack:
- [x] Slack custom + hosted adapters exist on the branch (JP's work). Present and
  served on the stack.
- [ ] Live re-verify Slack end to end on this stack (not re-done yet this round).

Frontend — the new design on the AGENT PAGE:
- [ ] Wire the first-pass design (agenta-settings-ui/channels components) onto the
  AGENT PAGE, connected to the real backend (connections, agents, hosted bind
  link) for BOTH Slack and Telegram.
- [ ] Desktop and /m parity.
- [ ] Light and dark mode.
- [ ] Storybook entries.
- [ ] Leave the old Settings channels screen in place, untouched.

Cross-cutting:
- [ ] Codex (gpt-astra) review of the new frontend + disconnect fix.
- [ ] CodeRabbit on each PR.
- [ ] Live QA end to end through the UI (desktop + /m), plus UI visual QA.
- [ ] Update STATUS.md after each milestone.

## Branches / PRs
- Tip branch the stack serves: `channels/telegram-hosted` (contains Slack +
  Telegram backend + the existing Settings channels UI).
- Stack order: channels/fix-approval-card-on-park -> channels/telegram (#6679)
  -> channels/telegram-hosted (#6724).
- Frontend work: a new branch stacked on `channels/telegram-hosted`.

## Running deployment
- Stack: `agenta-ee-dev-channels` (this worktree). Public URL:
  https://subangular-groundlessly-bryn.ngrok-free.dev (local 127.0.0.1:8180).
- Hosted Telegram enabled via a LOCAL gitignored override (test bot @newagentabot);
  not committed, does not affect PRs/prod. Webhook points at the hosted path.
- Live QA account: ~/.agenta-telegram-qa.env (Telethon). Driver scripts in the
  session scratchpad.

## Known limits / follow-ups
- Hosted needs a dedicated production bot token for prod (staging reuses the test
  bot, per Mahmoud).
- Disconnect binding cleanup: being fixed now.

## History
Detailed chronology is in overnight-progress.md. This file is the live map.
