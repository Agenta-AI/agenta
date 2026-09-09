# Channels (Slack + Telegram) — Handoff

The single entry point for continuing this project. Read this, then
`docs/design/channels-research/v2/STATUS.md` for the running task detail.

## Goal
Ship a production-ready channels release. Slack and Telegram both work end to end.
A user connects an agent to them from the AGENT PAGE using the new designed screen.
The old technical channels screen stays in Settings until a new version replaces it.

## Where everything is
Branches (a linear stack; each PR's base is the branch below it):
- `channels/telegram` — custom Telegram bot. PR #6679, base channels/fix-approval-card-on-park.
- `channels/telegram-hosted` — hosted (Agenta-owned) Telegram bot. PR #6724, base channels/telegram.
- `channels/telegram-ui` — the connect screen on the agent page. NO PR yet, base channels/telegram-hosted.
All three are pushed. PRs are ready but must NOT be merged yet.

Running stack: `agenta-ee-dev-channels` (this worktree,
/home/mahmoud/code/agenta-2-worktrees/channels). Public URL
https://subangular-groundlessly-bryn.ngrok-free.dev ; direct origin on the box
http://144.76.237.122:8180 ; local curl http://127.0.0.1:8180. Postgres port 5437.
The hosted Telegram bot is enabled on the stack via a LOCAL gitignored override
(test bot @newagentabot, id 8950712471). QA project 01a080e0-77ee-7c50-be4c-04a2b0ce1af8,
workspace 01a080e0-77d0-7893-937a-8317bd847299.

Key code:
- Backend Telegram: api/oss/src/core/channels/adapters/telegram/ (custom) and
  adapters/telegram_hosted/ (hosted); core/channels/telegram_binding.py +
  dbs/postgres/channels/telegram_bind_dao.py + migration oss000000030;
  apis/fastapi/channels/ingress.py (hosted branch) + router.py (bind-link endpoint);
  core/channels/service.py (ensure_hosted_telegram_connection, retarget, disconnect release).
- Frontend: web/packages/agenta-settings-ui/src/channels/ (ChannelsPage, ChannelConnectFlow,
  ChannelManagePanel, types); web/oss/src/state/channels/api.ts (data layer: bind-link + archive);
  web/oss/src/components/pages/overview/agent/AgentChannelsCard.tsx (host wrapper);
  web/packages/agenta-entity-ui/src/agent/AgentOverviewBody.tsx (rail slot);
  AgentOverview.tsx mounts the card.

## Status
Backend — DONE, reviewed (Codex gpt-astra + CodeRabbit), unit-tested (878 channels+secrets),
live-verified through the QA Telegram account:
- Custom Telegram: DM, groups (needs the bot's group privacy off), memory, HTML escaping.
- Hosted Telegram: full tap-to-connect (deep link -> /start -> chat bound -> agent answers),
  concurrency-safe bind, disconnect releases the binding, private-chat scope, per-project.
- Option 1 retarget: connecting Telegram from an agent points the project's one shared
  connection at THAT agent; a different agent gets retargeted, the same agent is a no-op.

Frontend — first pass, on channels/telegram-ui, compiles on the stack:
- The designed Channels card is mounted on the agent Overview rail, reads real connections,
  and connects Telegram via the real bind link; Disconnect archives.
- Codex reviewed it and raised 7 issues. FIXED (5): render the rail slot; sync fetched
  connections; skip archived rows; preserve the hosted flag in the schema; retarget backend.
- REMAINING (3): (a) the Telegram link-click fabricates a "connected" state before /start
  completes — separate link creation from the confirmed bind and use the real connection id;
  (b) the frontend 3-state card for Option 1 (connected here / connected to agent X, connect
  here / not connected) with agent-name resolution and wording; (c) error and pending states
  (mint 404, archive failure, stuck "Preparing…").

## Locked decisions
- Connect screens live on the AGENT PAGE; the old Settings channels screen stays untouched.
- Telegram is per-PROJECT (one shared connection), retargeted by agent (Option 1): if it is
  connected to another agent, say "Connected to agent X" and offer "disconnect from agent X
  and connect here", which retargets it.
- Testing reuses one bot (@newagentabot). Images/voice out of scope this release. Hosted
  Telegram is private chats only for v1. PRs ready but not merged.

## Next steps (in order)
1. Finish the frontend: the 3 remaining Codex items above (the 3-state card is the big one),
   then Slack connect, the QR image (no web QR lib yet — add one or render inline SVG), the /m
   app mount (web/mobile/src/features/agents/AgentOverviewScreen.tsx), a dark-mode pass, and
   Storybook entries. Codex advised regenerating the api-client (Fern) for the bind-link
   instead of the direct fetch (web/AGENTS.md requires Fern for new backend functions).
2. Visual QA in a browser on the agent Overview page; screenshot desktop and /m, light and dark.
3. Run a Codex review of the finished frontend + CodeRabbit on the PR; address findings.
4. Open the channels/telegram-ui PR (ready, not merged). Confirm all three PRs are review-ready.

## How to run / verify
- Unit tests (in the api container): docker exec -w /app agenta-ee-dev-channels-api-1 python -m
  pytest oss/tests/pytest/unit/channels/ oss/tests/pytest/unit/secrets/ -o asyncio_mode=auto -p no:cacheprovider -q
- Frontend compile check: curl a page on http://127.0.0.1:8180 and read
  `docker logs agenta-ee-dev-channels-web-1` for the compile result.
- Live Telegram QA: the QA account is ~/.agenta-telegram-qa.env (Telethon driver in the
  session scratchpad); drive @newagentabot.
- If the worktree is missing (the daily cleanup removes pushed worktrees): recreate with
  `git worktree add <path> channels/telegram-ui`, then `chmod -R a+rwX web/` and
  `docker restart` the web and api containers so their source mounts re-resolve. The env file
  and the local docker override are gitignored; rebuild them from a sibling stack (recipe in STATUS.md).

## The full PR stack (all channels PRs, bottom to top)
This is one linear stack. Each PR's base is the PR below it. Slack, the bridge, and
the Agenta channel are in the foundational PR (#6644); Telegram and the UI are on top.
- #6644 feat/channels -> release/v0.115.4 — Channels foundation: Slack, bridge, Agenta
  channel (takeover of the original #6051). This is where Slack lives.
- #6646 channels/fix-deploy-blockers -> feat/channels — first-deploy fixes (slug, handshake, refs).
- #6647 channels/fix-conversation-semantics -> fix-deploy-blockers — what opens a turn; DM = one conversation.
- #6649 channels/fix-edit-and-delivery -> fix-conversation-semantics — edit semantics; failed-post write.
- #6650 channels/fix-approvals-seam -> fix-edit-and-delivery — approval answer resumes the parked turn.
- #6651 channels/feature-flag -> fix-approvals-seam — feature flag (env var + UI switch).
- #6652 channels/docs-and-decisions -> feature-flag — takeover decision record, live QA, findings.
- #6653 channels/fix-approval-card-on-park -> docs-and-decisions — render the approval card on a park.
- #6679 channels/telegram -> fix-approval-card-on-park — custom Telegram bot (my work).
- #6724 channels/telegram-hosted -> telegram — hosted Telegram bot (my work).
- channels/telegram-ui -> telegram-hosted — the agent-page connect screen (my work, no PR yet).
All PRs are ready for review, NOT to be merged yet. Merge order is bottom-up, into
release/v0.115.4 (never main). Check each PR's threads + Codex/CodeRabbit before merging.

## Slack status
Slack is JP's foundational work in #6644 and the fix-* PRs above, reviewed and live-QA'd
during that stack (see takeover-2026-09-08.md and review-*.md). What exists:
- Adapters: api/oss/src/core/channels/adapters/slack/ (hosted OAuth install + custom
  "own app"); the bridge adapter for Slack-over-bridge.
- Settings UI: web/oss/src/components/pages/settings/Channels/components/Slack*.tsx
  (SlackHostedAppSection, SlackOwnAppSection) — the OLD technical screen, which stays.
- The hosted Slack app uses SLACK_CLIENT_ID/SECRET/SIGNING_SECRET (env.channels.slack).
Remaining for Slack in THIS release: wire Slack connect into the NEW agent-page design
(hosted install is an OAuth redirect; mirror the Telegram card's states), and a fresh
live QA of Slack on this stack (not re-done during the Telegram/UI work).

## History and work-package docs (read for the full story)
JP tracked the whole build as work packages and waves. For any earlier context:
- docs/design/channels-research/v2/plan.md — the work-package map (WP0..WP19).
- docs/design/channels-research/v2/waves.md + workstreams/ — waves, exit conditions,
  per-package specs and task lists, file ownership.
- docs/design/channels-research/v2/takeover-2026-09-08.md — the takeover decision record.
- docs/design/channels-research/v2/decisions.md, review-findings.md,
  review-telegram-quality.md, design-findings.md — decisions and review history.
- docs/design/channels-research/v2/overnight-progress.md — the dated chronology of the
  Telegram + hosted + UI work (my sessions).
- STATUS.md — the live map and current task detail.
