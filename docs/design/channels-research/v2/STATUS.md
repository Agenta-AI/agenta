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
- [x] F2 Data layer: bind-link + archive calls in api.ts. The real calls exist in web/oss/src/state/channels/api.ts
  (connections, agents, spaces, grants, policy). ADD the hosted bind-link call
  (POST /catalog/channels/telegram_hosted/bind-link/) — NOT in the generated
  client yet, so add a direct authed call (getAgentaApiUrl + JWT + project_id),
  clearly marked, or regenerate the client if low-risk. Build read/mutate hooks:
  list connections, connect hosted Telegram (mint link), connect Slack (hosted
  install redirect), custom Telegram (createChannelConnection + bot token),
  behavior switches (map dm/group to grants/policy), disconnect (archive).
- [~] F3: mapConnections reads real rows; hosted-Telegram CONNECT is wired to
  the real bind link (compiles on the stack). REMAINING: browser QA, QR image,
  disconnect (archive), Slack connect, behavior switches. Original F3 text:
  Map the design's simple model to the backend: design ChannelConnections
  {slack,telegram:{kind,status,dm,group,chats}} <- connections + agents + grants +
  policy + spaces. Replace the components' placeholder local state with the real
  queries/mutations. Keep the design's look.
- [~] F4 Mounted on the agent overview: AgentChannelsCard (web/oss) renders
  ChannelsPage in an antd Drawer, in the AgentOverviewBody rail slot. The route
  COMPILES cleanly (verified on the stack). Reads real connections. REMAINING:
  browser QA screenshot, and wire the connect/disconnect ACTIONS (F3).
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

## INCIDENT 2026-09-09: channels worktree wiped; code safe, env lost
The worktree /home/mahmoud/code/agenta-2-worktrees/channels was removed from disk
mid-session (likely the daily dev-box cleanup removing a worktree whose branch was
fully pushed). Impact:
- SAFE: all branches are intact on the remote (channels/telegram, -hosted, -ui).
  Recreated the worktree from channels/telegram-ui (HEAD a135b200d1). No code lost.
- LOST (gitignored, gone with the dir): the stack env file
  hosting/docker-compose/ee/.env.ee.dev.channels, the local override
  docker-compose.dev.channels.local.yml (image tags + runner login mounts + the
  hosted TELEGRAM_HOSTED_* env), and the hosted webhook secret.
- STILL RUNNING: all 18 agenta-ee-dev-channels containers keep working on their
  baked-in env (hosted was verified answering earlier this session). But the WEB
  container's source mount points at the deleted inode, so it will NOT serve the
  recreated worktree until recreated; and no container can be recreated without the
  env file.

Recovery recipe (to redeploy for live QA; see deploy-worktree-testing skill):
1. cp /home/mahmoud/code/agenta/hosting/docker-compose/ee/.env.ee.dev.local
   hosting/docker-compose/ee/.env.ee.dev.channels ; chmod 600 ; set
   COMPOSE_PROJECT_NAME=agenta-ee-dev-channels, ENV_FILE, TRAEFIK_PORT=8180, the
   AGENTA_*_URL to the ngrok host, POSTGRES_PORT to this stack's (5437).
2. Recreate the local override docker-compose.dev.channels.local.yml: image tags
   (agenta-ee-dev-channels-*:latest), runner login mounts
   (/home/mahmoud/agenta-qa-logins/{claude,codex,pi-agent}) + CLAUDE_CONFIG_DIR/
   CODEX_HOME/PI_CODING_AGENT_DIR, and hosted env on api+worker-queues+worker-streams:
   TELEGRAM_HOSTED_BOT_TOKEN=8950712471:AAHy_T8wxHF99NxH_isKJ9RD0CrGSAauefo,
   TELEGRAM_HOSTED_WEBHOOK_SECRET=<generate a fresh one>, TELEGRAM_HOSTED_BOT_USERNAME=newagentabot.
3. chmod o+w web/ee/public web/oss/public (uid 10001 writes __env.js).
4. Recreate: docker compose -p agenta-ee-dev-channels --env-file .env.ee.dev.channels
   -f docker-compose.dev.yml -f docker-compose.dev.channels.local.yml up -d
   --no-deps --force-recreate api worker-queues worker-streams web.
5. setWebhook the bot to <ngrok>/api/channels/telegram/events/8950712471/ with the
   fresh secret. The hosted connection + chat binding persist in Postgres.
RISK NOTE: the daily cleanup may remove this worktree again whenever its branch is
fully pushed. Keep work pushed (safe) and recreate the worktree per session; do not
rely on gitignored files surviving. Consider leaving one uncommitted sentinel file
if the cleanup skips dirty worktrees.
