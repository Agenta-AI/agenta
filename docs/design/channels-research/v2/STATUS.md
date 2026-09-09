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
- [x] Disconnect frees the chat binding so a chat can reconnect (incl. to a
  different project). DAO delete_bindings_for_connection, released in the archive
  endpoint; unit-tested + DB-verified. (Codex P2 closed.)

Backend — Slack:
- [x] Slack custom + hosted adapters exist on the branch (JP's work). Present and
  served on the stack.
- [ ] Live re-verify Slack end to end on this stack (not re-done yet this round).

Frontend — the new design on the AGENT PAGE (branch channels/telegram-ui):
Sequenced build plan. Each step ends committed + verified; deploy to the stack and
screenshot before marking a UI step done (UI changes need browser QA).
- [x] F1 Placed the first-pass design components into web/packages/agenta-settings-ui/
  src/channels/ (ChannelsPage, ChannelConnectFlow, ChannelManagePanel, helpers,
  icons, types, index). Package already has @agenta/ui + phosphor. Do NOT export
  from the package index until wired, so the app build is untouched. Verify the
  web container still builds.
- [~] F2 Data layer (bind-link + archive calls added to api.ts; hooks/mapping next). The real calls exist in web/oss/src/state/channels/api.ts
  (connections, agents, spaces, grants, policy). ADD the hosted bind-link call
  (POST /catalog/channels/telegram_hosted/bind-link/) — NOT in the generated
  client yet, so add a direct authed call (getAgentaApiUrl + JWT + project_id),
  clearly marked, or regenerate the client if low-risk. Build read/mutate hooks:
  list connections, connect hosted Telegram (mint link), connect Slack (hosted
  install redirect), custom Telegram (createChannelConnection + bot token),
  behavior switches (map dm/group to grants/policy), disconnect (archive).
- [ ] F3 Map the design's simple model to the backend: design ChannelConnections
  {slack,telegram:{kind,status,dm,group,chats}} <- connections + agents + grants +
  policy + spaces. Replace the components' placeholder local state with the real
  queries/mutations. Keep the design's look.
- [ ] F4 Mount on the AGENT PAGE (desktop). Find the agent detail/overview page
  (components/pages/overview/agent or the agent view), add a "Channels"/"Connect"
  section rendering ChannelsPage with an antd/@agenta drawer as renderPanel.
- [ ] F5 Mount on /m (web/mobile/src/features/agents/AgentOverviewScreen.tsx) with
  a bottom-sheet renderPanel. Desktop + /m parity.
- [ ] F6 Light + dark mode pass; Storybook entries for the components.
- [ ] F7 Leave the old Settings channels screen in place, untouched.
Mount point notes (RESOLVED 2026-09-09): desktop agent overview =
web/oss/src/components/pages/overview/agent/AgentOverview.tsx, which renders
AgentOverviewBody (web/packages/agenta-entity-ui/src/agent/AgentOverviewBody.tsx)
with a config rail (AgentConfigSummaryCard, AgentFilesCard). The Channels section
is a new rail card there. /m agent overview = features/agents/AgentOverviewScreen.tsx.

Wiring prerequisites found (do these inside F2/F3, each leaving a compilable state):
- PRE-1 QR: there is NO QR library in web. Options: (a) add a small dep like
  qrcode.react (needs a package.json change + install, which is a shared-tree
  hazard; build in a worktree/container carefully); (b) vendor a tiny pure-JS QR
  encoder that emits inline SVG (no dep); (c) v1 ship the tappable deep link
  only, QR as a fast-follow. RECOMMEND (b) if a small MIT encoder fits, else (c)
  first so the flow works, then add QR. Mahmoud wants QR, so do not drop it
  silently; land the link, then the QR.
- PRE-2 references: RESOLVED. RESOLVABLE_AGENT_REFERENCE_KEYS includes
  "application", so the agent page connects with {application:{id: appId}}
  directly (appId is the application id) -- no variant lookup needed. Verify it
  resolves to a runnable agent during live QA.
- PRE-3 rail injection: read AgentOverviewBody.tsx to see how a new rail card is
  added (edit it directly or via a slot). Add an AgentChannelsCard rendering the
  design's ChannelsPage with an @agenta/ui drawer (./drawer export) as renderPanel.

Retrofit approach (decided): keep the first-pass components' JSX/look; inject real
async actions as optional props (default to the existing simulate handlers so the
package keeps compiling), then a web/oss wrapper supplies the real actions + real
initial connections (mapped from queryChannelConnections) + the drawer. Wire the
Telegram-hosted connect first (createTelegramHostedBindLink + real link/QR), then
disconnect (archiveChannelConnection), then Slack hosted (OAuth redirect), then the
behavior switches (grants/policy), then custom Telegram (createChannelConnection).

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
- Disconnect binding cleanup: DONE (release on archive).

## History
Detailed chronology is in overnight-progress.md. This file is the live map.
