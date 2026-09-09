# Channels (Slack + Telegram) — project status

The single source of truth for this project's state. Updated after every
milestone. Read this first. If a detail lives in another doc, this file links to
it; this file stays the map.

Last updated: 2026-09-09 (evening: frontend finished, live-verified through the UI).

## INFRA FACTS (do not re-derive; correct as needed)
- The ngrok tunnel is PAID, not free. There is NO interstitial. If a browser XHR
  fails, it is NOT ngrok's warning screen — look elsewhere (stale build, expired
  session, wrong path).
- Public URL: https://subangular-groundlessly-bryn.ngrok-free.dev. Direct origin on
  the box: http://144.76.237.122:8180 (traefik). Local curl: http://127.0.0.1:8180.
- Stack: agenta-ee-dev-channels (this worktree). Postgres port 5437. QA project
  01a080e0-77ee-7c50-be4c-04a2b0ce1af8, workspace 01a080e0-77d0-7893-937a-8317bd847299.
- Hosted Telegram enabled on the stack (test bot @newagentabot, id 8950712471).
- Browser QA uses the shared Chrome via chrome-devtools; session auth is SuperTokens
  cookies. I do NOT type passwords (policy) — need a live session or OTP.


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
## DECISION (Mahmoud): per-project Telegram, retarget by agent (Option 1)
A hosted Telegram connection is ONE per project. The agent page shows one of three
states for Telegram:
- Not connected -> "Connect".
- Connected, and this project's Telegram already answers as THIS agent -> "Connected".
- Connected, but it answers as ANOTHER agent (agent X) -> say "Connected to agent X",
  and offer "Disconnect from agent X and connect here". "Connect here" retargets the
  connection's default agent to THIS agent (edit/set the default channel-agent's
  references to {application:{id: appId}}), not a full teardown.
Implementation: resolve the connection's current default channel-agent -> its
referenced app id -> that app's name. Compare to appId for the 3 states. "Connect
here" = set this app as the connection's default agent. Slack later mirrors this.

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
- [x] F3 (done 2026-09-09 evening, see the section at the bottom). Earlier note: mapConnections reads real rows; hosted-Telegram CONNECT is wired to
  the real bind link (compiles on the stack). hosted-Telegram CONNECT + DISCONNECT wired (compile-verified). REMAINING:
  browser QA (needs a live session), QR image, Slack connect, behavior switches. Original F3 text:
  Map the design's simple model to the backend: design ChannelConnections
  {slack,telegram:{kind,status,dm,group,chats}} <- connections + agents + grants +
  policy + spaces. Replace the components' placeholder local state with the real
  queries/mutations. Keep the design's look.
- [x] F4 (done 2026-09-09 evening; browser-verified light + dark). Earlier note: Mounted on the agent overview: AgentChannelsCard (web/oss) renders
  ChannelsPage in an antd Drawer, in the AgentOverviewBody rail slot. The route
  COMPILES cleanly (verified on the stack). Reads real connections. REMAINING:
  browser QA screenshot, and wire the connect/disconnect ACTIONS (F3).
- [x] F5 Mounted on /m (web/mobile/src/features/agents/AgentChannelsCard.tsx, bottom sheet via
  Sheet side=responsive); browser-verified on a 390px viewport.
- [x] F6 Dark-mode pass (screenshots in ~/agenta-qa-evidence/2026-09-09-channels-ui-v2/);
  Storybook stories co-located in web/packages/agenta-settings-ui/src/channels/*.stories.tsx.
- [x] F7 The old Settings channels screen is untouched.
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
- [~] Codex (gpt-astra) review of the finished frontend: first round done (7 findings, all
  addressed); a second round on the final diff is the next step.
- [ ] CodeRabbit on each PR.
- [x] Live QA end to end through the UI (desktop + /m), plus UI visual QA (2026-09-09 evening).
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

## Browser QA BLOCKED by a degraded dev web (2026-09-09)
After the worktree wipe + recovery (recreate worktree, chmod, web restart, deps
install completed, cleared .next and rebuilt), the web app renders BLANK at /w
(bodyLen 0). Verified it is NOT the channels code: the only client errors are
harmless PostHog 404s, and the agent-overview route compiles 200 server-side. The
blank is a dev-server/session state after the recovery, not my changes.
State of the UI code (all pushed on channels/telegram-ui, compiles on the stack):
F1 components placed; F2 data layer (bind-link + archive); F3 hosted-Telegram
CONNECT wired to the real bind link; F4 mounted on the agent overview rail reading
real connections. NOT yet browser-verified due to the blank app.
To unblock visual QA: do a clean stack redeploy — restore the lost env file from a
sibling (see the recovery recipe above), recreate web (and api/workers for hosted
env), then load an agent overview. Root cause of the instability: the daily cleanup
removes this worktree once its branch is pushed, taking the gitignored env/override
with it. Recommend excluding this worktree from the cleanup.

## Browser QA root cause pinned (2026-09-09)
Two facts block the in-browser visual QA; neither is the channels code.
1. ngrok free blocks the app's browser API calls. Loaded via the ngrok URL, the
   app's XHRs fail ("Failed to fetch") because ngrok free serves an interstitial /
   abuse screen to browsers. curl works (not a browser), which is why health is 200
   server-side but the app renders blank. Injecting `ngrok-skip-browser-warning`
   got the app to RENDER (it reached /auth), but XHRs stay flaky.
   Fix: do browser QA via the DIRECT server origin http://144.76.237.122:8180, not
   ngrok. That needs the app's API URL to be the IP too (either a redeploy with
   AGENTA_*_URL=http://144.76.237.122:8180, or a session-local __env override via an
   initScript) so calls are same-origin IP->IP and skip ngrok.
2. Auth. The prior session redirected to /auth (session check could not reach the
   API over ngrok). Re-login needs a password, which I do not enter (policy). The
   QA account's OTP path (testmail) or a fresh valid session from Mahmoud is the
   way in. On the IP origin the ngrok cookie does not apply, so a login is needed
   there regardless.
Net: visual QA needs (a) the IP origin wired and (b) an auth path that is not me
typing a password. The code (F1-F4 first pass) compiles on the stack and is pushed.

## Empty-app root cause CONFIRMED (2026-09-09): browser session refresh fails
Captured the network on the running app: it renders empty because
POST /api/auth/session/refresh fails with "Failed to fetch" and getJWT logs
"Failed to fetch JWT". With no JWT the app makes no authed API calls, so every
page shows only the "Agenta" shell. This is a SuperTokens/session/stack issue in
the browser, NOT the channels code (which compiles; only PostHog 404s otherwise).
curl to /api works because it is not a browser doing session refresh. Visual QA is
blocked until the app can refresh its session in the browser. Needs Mahmoud to
confirm whether it renders in his own browser, or a stack auth fix.
Meanwhile: UI code (F1-F4 first pass; Telegram connect + disconnect wired) compiles
and is pushed on channels/telegram-ui. Running Codex review of it now (no browser
needed).

## Codex UI review 2026-09-09: "do not merge as working"; findings tracked
Codex (gpt-astra) reviewed channels/telegram-ui. Fixed now: #1 render the {channels}
slot (card never mounted); #2 ChannelsPage syncs with initialConnections (fetched
connections were ignored). REMAINING (in priority order):
- [x P1 #3] No more fabricated connected state; refetch after connect/disconnect
  gives the real connection id. DONE.
- [P1 #4] DESIGN QUESTION for Mahmoud: a hosted Telegram connection is per-PROJECT
  (one shared connection, reused across agents), but the design puts "connect" on
  the agent page as if per-agent. So the card currently shows/【archives every
  project connection regardless of agent. DECIDED Option 1. BACKEND DONE: ensure retargets the connection's answering
  agent to the calling agent (connect here). FRONTEND DONE: the 3-state card resolves the answering agent + name and
  shows 'Answers as X, connect here'; connecting retargets. Compiles; needs browser QA.
- [x P2 #5] Exclude archived rows (deleted_at) before mapping. DONE.
- [x P2 #6] Preserve flags.is_hosted in the schema. DONE.
- [~ P2 #7] Connect-side error+retry added (mint 404 no longer sticks). REMAINING:
  show an archive-failure message and disable Disconnect while it runs.
Codex direct answers: regenerate the api-client (Fern) for the bind-link instead of
the direct fetch (web/AGENTS.md requires it); keep action injection but remove the
implicit simulate (move fixtures to Storybook); hide unfinished Slack/custom/QR/
policy for v1; keep the rail slot; remove the unused unarchive wrapper.


## Frontend finished and live-verified through the UI (2026-09-09 evening)
Branch channels/telegram-ui. Everything below is browser-verified on the channels stack with a
throwaway account (channels-ui-<epoch>@test.agenta.ai, created via the admin endpoint; the
QA project's owner mailbox cannot receive codes, and its password is not ours to type).
Screenshots: ~/agenta-qa-evidence/2026-09-09-channels-ui-v2/ (01-09).

Backend additions (small, on this branch):
- `GET /channels/catalog/channels/telegram_hosted/bindings/?connection_id=` lists the chats a
  /start has bound to the hosted connection (project-scoped; 404 when no hosted bot). The UI
  polls it to tell "link minted" apart from "chat connected" (Codex #3).
- The bind-link response now carries `connection_id`.
- Fix: `unarchive_connection` now restores the agents that were archived together with the
  connection (same instant). Without it a reconnect after a disconnect recreated the "default"
  agent and tripped `uq_channel_agents_connection_slug` / `uq_channel_agents_default` (500 on
  the bind-link mint). Found live; unit-tested (883 channels+secrets).
- The generated TypeScript client was regenerated for the channels resource only (the sessions
  drift in the same spec was reverted on purpose; it renames SessionCapabilities and is not ours).

Frontend (web/packages/agenta-settings-ui/src/channels, web/oss, web/mobile):
- `actions.ts`: `buildAgentChannelsActions({client, projectId, appId, resolveAgentName,
  hostedSlackInstallUrl})` holds every backend call and the mapping; both hosts are thin
  (desktop: antd Drawer; /m: Sheet). Per web/AGENTS.md the calls go through the generated
  client, not a raw fetch.
- The 3-state card (Option 1): not connected -> Connect; connected here -> manage; connected to
  agent X -> "Connected to X" + "Connect here" (retargets the connection's default channel agent
  to this app via editChannelAgent, or creates it when the connection has none).
- Pending state: a hosted Telegram connection with zero bound chats reads "Not linked yet ·
  finish connecting" and opens the connect flow, never the manage view. (A reload during the
  flow used to flip the panel to "connected" before /start; seen live after a hot reload.)
- Hosted Telegram flow: mint -> real QR (vendored dependency-free encoder, `qr/encode.ts`, 7
  unit tests) + deep link + copy -> waiting (polls bindings until the count rises; link expiry
  -> "Get a new link"; "I already linked this chat" escape) -> linked -> manage.
- Hosted Slack: opens the install redirect in a new tab (fallback link under the button), polls
  the connections until the Slack connection appears, then points it at this agent.
- Custom Slack/Telegram: the fields come from `fetchChannelSetup` (Slack: bot token, signing
  secret, app id; Telegram: bot token), the manifest is the real one (copy + review),
  `createChannelConnection` then the default agent for this app. The design's client-id /
  client-secret fields and the name/handle step were dropped: the backend declares different
  fields and the manifest is fixed.
- Errors and pending: mint failure -> alert + Try again + Use your own bot; archive failure ->
  alert, panel stays open; Disconnect and Connect-here disabled while running; the message
  comes from the API's `detail` / `detail.message`, never Fern's "Status code: …" wrapper.
- Left out on purpose (not wired in this release, so not shown as placeholders): the chat
  list, the DM/group behavior switches, the Advanced policy rows, allowed Telegram user ids.

Live checks that passed (throwaway project):
- Card in all three states; "connect here" retarget (Answers as -> this agent); disconnect
  (archive) -> row back to Connect; reconnect -> QR -> Telethon `/start <token>` -> the bot says
  "You are connected" -> the panel flips to linked/manage on its own (poll) -> row shows
  "@newagentabot · Direct messages".
- Bindings refusal path: a chat bound to another project gets the generic "not valid anymore"
  reply (ingress design), the count does not rise.
- Hosted Slack: "Add to Slack" lands on slack.com/oauth with the right scopes + callback;
  waiting state + cancel + fallback link work. Not completed: needs a Slack workspace login.
- Custom Slack: manifest loads and renders; the three declared fields render; Connect stays
  disabled until filled. Not submitted: the QA Slack env has no signing secret.
- /m: the card and the bottom sheet render with real data (390px viewport).
- Dark mode: card, manage panel, both Slack flows (screenshots 05-08).

NOT verified today: the agent's ANSWER in Telegram on the throwaway project. The message
reaches the agent (inbox -> dispatch -> runner session), but every QA key fails at the model:
the OpenAI QA key has no credits ("You have no credits remaining"), and the Claude harness
did not bind the vault's Anthropic key (`credentialMode=runtime_provided credentialBindings=[]`,
"model authentication failed") — a model-credential matter outside channels. The answer path
was live-verified earlier today on the QA project (HOSTEDOK, see overnight-progress.md).
Finding for the release: a failed run leaves Telegram silent (the "Thinking…" indicator is
marked sent but the user never sees an error).

Stack repairs done today (not code): the worktree wipe had left worker-queues, worker-streams,
services, runner and web-mobile mounting the deleted inode (workers crash-looped with "No module
named entrypoints.worker_queues"; services could not reach the runner). Rebuilt the env file
from the api container's env and a local override (image tags + runner login mounts), then
recreated those five containers. Both files are gitignored; the recipe stands.
