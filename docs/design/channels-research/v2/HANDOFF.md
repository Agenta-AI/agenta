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
- `channels/telegram-ui` — the connect screen on the agent page (+ the bindings endpoint and
  the unarchive-cascade fix). PR #6737, base channels/telegram-hosted.
  All three are pushed. PRs are ready but must NOT be merged yet. Merge order is bottom-up into `release/v0.118.1`, never into main.

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
  dbs/postgres/channels/telegram_bind_dao.py + migration oss000000031;
  apis/fastapi/channels/ingress.py (hosted branch) + router.py (bind-link endpoint);
  core/channels/service.py (ensure_hosted_telegram_connection, retarget, disconnect release).
- Frontend: web/packages/agenta-settings-ui/src/channels/ (ChannelsPage, ChannelConnectFlow,
  ChannelManagePanel, types); web/oss/src/state/channels/api.ts (data layer: bind-link + archive);
  web/oss/src/components/pages/overview/agent/AgentChannelsCard.tsx (host wrapper);
  web/packages/agenta-entity-ui/src/agent/AgentOverviewBody.tsx (rail slot);
  AgentOverview.tsx mounts the card.

## Review round of 2026-09-12 (rebase, Codex, CodeRabbit)

- The whole stack now sits on `release/v0.118.1`: #6644 targets it, every other PR
  keeps the branch below it as base. The release merge was done lane by lane (merge
  commits, not rebases), so each PR still shows only its own delta.
- The release took migration id `oss000000029` (subscription provider). The channels
  migrations moved: `oss000000030_add_channels` (#6644) and
  `oss000000031_add_telegram_hosted_bind` (#6724). A dev database that ran the old ids
  needs its `alembic_version_oss` row set to `oss000000031` by hand, plus
  `ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_PROVIDER'`.
- The release removed the Triggers settings tab; the merge drops it from the channels
  navigation additions too. The mobile overview moved to its own body component; the
  Channels card is passed into its rail.
- Codex (gpt-6-astra, medium) reviewed #6644 to #6653. Each PR carries a summary comment
  with a table of findings and their state. Fixed in the stack: one reference family per
  agent, Slack `/me` messages, a bare command is no mention, MESSAGE scope reuses its own
  thread on redelivery, a plain reply continues the thread's agent (`fetch_active_thread`),
  the indicator never overwrites a failed answer, the deployment flag stops both worker
  consumers, the ledger statuses, every terminal turn publishes, the records batch stays
  unacknowledged when turn_ended fails, and the interaction resolver takes pending rows only.
- Deferred, all in https://github.com/Agenta-AI/agenta/issues/6786: atomic outbox claim,
  pending-choice compare-and-set, card-bound action ids, lost update on edits, response
  admission for channel answers, conditional clear, the `!new` fill boundary in threads.
- Every CodeRabbit thread on the stack is answered and resolved.

## Status

Backend — DONE, reviewed (Codex gpt-astra + CodeRabbit), unit-tested (878 channels+secrets),
live-verified through the QA Telegram account:

- Custom Telegram: DM, groups (needs the bot's group privacy off), memory, HTML escaping.
- Hosted Telegram: full tap-to-connect (deep link -> /start -> chat bound -> agent answers),
  concurrency-safe bind, disconnect releases the binding, private-chat scope, per-project.
- Option 1 retarget: connecting Telegram from an agent points the project's one shared
  connection at THAT agent; a different agent gets retargeted, the same agent is a no-op.

Frontend — DONE on channels/telegram-ui, live-verified through the UI on desktop and /m,
light and dark (2026-09-09 evening; details and screenshots in STATUS.md, section
"Frontend finished and live-verified through the UI"):

- The 3-state card (not connected / connected here / connected to agent X + connect here),
  the pending state (link minted, no chat bound yet), the real hosted-Telegram flow with a
  vendored QR encoder and a bind poll, hosted Slack (install redirect + poll), custom Slack
  and Telegram on the backend-declared fields and manifest, error and pending states.
- All 7 Codex findings from the first review are addressed. Two more bugs found live and
  fixed: reconnect after disconnect 500'd (unarchive did not restore the agents); a reload
  during the connect flow showed "connected" before /start (now "pending").
- Shared actions builder in the package (`actions.ts`); hosts are thin (Drawer on desktop,
  Sheet on /m). Stories co-located in the package. QR encoder unit-tested.
- Not verified: the agent's answer in Telegram on the throwaway project (QA model keys fail:
  OpenAI has no credits; the Claude harness did not bind the vault key). The answer path was
  live-verified earlier the same day on the QA project.

## Locked decisions

- Connect screens live on the AGENT PAGE; the old Settings channels screen stays untouched.
- Telegram is per-PROJECT (one shared connection), retargeted by agent (Option 1): if it is
  connected to another agent, say "Connected to agent X" and offer "disconnect from agent X
  and connect here", which retargets it.
- Testing reuses one bot (@newagentabot). Images/voice out of scope this release. Hosted
  Telegram is private chats only for v1. PRs ready but not merged.

## Next steps (in order)

1. Codex round two is done (STATUS.md, last section): the quick fixes are on the branch; the
   deferred P1s need backend work (one "connect as app X" operation; reconnect paths for
   custom and hosted Slack). Decide with Mahmoud whether they block this release.
2. PR #6737 is open (base channels/telegram-hosted). CodeRabbit skips this base branch, so
   the review is Codex + a human. Do NOT merge.
3. The stack-wide "TypeScript lint" red (four `import/order` errors in foundation files) is
   fixed on this branch as of 2026-09-10; the lower PRs still show it. CodeRabbit shows green
   on these PRs because it is disabled for the base branch, not because it reviewed.
   Mahmoud's 2026-09-10 feedback is implemented and live-checked: Telegram progress and
   Markdown, the Settings cleanup behind a "Channel debug" switch, and the full connected view
   from the design canvas (spaces, behavior switches, allowed users, advanced, revoked, the
   own-bot path). See STATUS.md, last two sections. Still unverified live: the Slack channel
   picker and a real token revocation.
4. Slack live QA on this stack through the NEW card: complete the hosted install (needs a
   Slack workspace login) and submit a custom app (needs the signing secret; the QA Slack env
   has it commented out). Both flows are wired and reach Slack; only the last step is unproven.
5. Give the throwaway project a working model key (or a Claude login the runner binds) and
   confirm the agent answers in Telegram from the UI-created connection.
6. Optional: a `test` script + vitest devDependency for @agenta/settings-ui so CI runs the QR
   tests (today they run via a sibling package's vitest binary; the lockfile change needs a
   pnpm install in a scratch clone, never in this tree).

## How to run / verify

- Unit tests (in the api container): docker exec -w /app agenta-ee-dev-channels-api-1 python -m
  pytest oss/tests/pytest/unit/channels/ oss/tests/pytest/unit/secrets/ -o asyncio_mode=auto -p no:cacheprovider -q
- Frontend compile check: curl a page on http://127.0.0.1:8180 and read
  `docker logs agenta-ee-dev-channels-web-1` for the compile result.
- Live Telegram QA: the QA account is ~/.agenta-telegram-qa.env (Telethon driver in the
  session scratchpad); drive @newagentabot.
- QR unit tests: from web/packages/agenta-settings-ui run
  `../agenta-entity-ui/node_modules/.bin/vitest run src/channels/qr/encode.test.ts --root .`
- Type-checks by binary path only (a `pnpm run` triggers an install that breaks the tree):
  `packages/agenta-settings-ui/node_modules/.bin/tsc --noEmit --incremental false -p packages/agenta-settings-ui/tsconfig.json`,
  same for oss/ and mobile/ with their own tsconfig.
- Browser QA: the QA project owner's mailbox gets no codes; create a throwaway account with
  the admin endpoint (`POST /admin/simple/accounts/` with an email:password identity, a
  password with a special character, and `allow_email: true` on its organization flags),
  then sign in on the ngrok URL with `?view=desktop` to skip the /m gate.
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
- #6737 channels/telegram-ui -> telegram-hosted — the agent-page connect screen (my work).
  All PRs are ready for review, NOT to be merged yet. Merge order is bottom-up, into
  release/v0.115.4 (never main). Check each PR's threads + Codex/CodeRabbit before merging.

## Slack status

Slack is JP's foundational work in #6644 and the fix-_ PRs above, reviewed and live-QA'd
during that stack (see takeover-2026-09-08.md and review-_.md). What exists:

- Adapters: api/oss/src/core/channels/adapters/slack/ (hosted OAuth install + custom
  "own app"); the bridge adapter for Slack-over-bridge.
- Settings UI: web/oss/src/components/pages/settings/Channels/components/Slack\*.tsx
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
