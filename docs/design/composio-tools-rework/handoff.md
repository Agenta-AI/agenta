# Handoff: gateway connection rework

Written 2026-08-27, end of the build-and-stabilize phase. This page is the entry point:
what the project is, what state it is in, what was done, and where everything lives.
Whoever picks this up starts here.

## What this project is

Composio integrations moved from one config entry per action to one entry per
integration (`gateway_connection`) with a per-tool permission policy, and the model's
tool surface collapsed to two derived tools for the whole agent: `search_tools` and
`run_tool`. Permissions are enforced in the runner at one seam, approvals are durable,
and connections never reach the model. The decided design is three pages:
[data-model.md](data-model.md) (the saved config),
[runtime-tools.md](runtime-tools.md) (the two tools),
[permission-layers.md](permission-layers.md) (who stores, compiles, enforces).

## Status right now

- PR [#6310](https://github.com/Agenta-AI/agenta/pull/6310) (backend: sdk + api +
  runner + this design workspace) and PR
  [#6311](https://github.com/Agenta-AI/agenta/pull/6311) (frontend: option 2a UI) are
  OPEN, both based on main, waiting for Mahmoud's review. CodeRabbit ran on both; 25
  comments fixed, 5 declined with reasons on the threads. The superseded #6163 and
  #6161 are closed with pointers.
- The test stack `agenta-ee-dev-toolkit` (port 8780, deploy worktree
  `/home/mahmoud/code/agenta-2-wt/toolkit-deploy`, branch `gateway-deploy-combined`)
  runs both PR tips and is where all live proof came from.
- Proven live, on real Composio side effects: the full Approve and Deny journeys (six
  runs green: durable answer in ~0.3 s, one resume per click, rows `resolved` with
  correct verdicts), the deny gate against forged relay files (uniform refusal that
  names nothing), search filtering with provider-id redaction, legacy migration, mixed
  legacy+connection revisions, and the weak-model journey on claude-haiku-4-5.
- Both QA provider keys (OpenAI and Anthropic) are OUT OF CREDIT. Autonomous QA model
  runs are blocked until one is topped up; Mahmoud's own self-managed models work.

## What was done, in order

1. **Plan.** The planning workspace ([plan.md](plan.md), [contracts.md](contracts.md),
   [research.md](research.md), [qa.md](qa.md)) was written, Codex-reviewed (33
   findings), and revised. Seven slices, every wire shape pinned in contracts.md.
2. **Slices 1 to 6.** SDK config model + pure permission compiler; API catalog
   identity + whole-catalog cache + `gateway_connection` resolve; the
   `gateway.search`/`gateway.run` routes with private context; the SDK resolver,
   `gatewayPolicy` wire, and prompt guidance; the runner's semantic gate, search
   filter, and approval identity; the frontend drawers with preset translation and
   TypeScript migration. Each slice was Codex-reviewed at high effort before landing;
   the runner gate got two adversarial passes (they found and fixed a prototype-key
   policy bypass and an approval-identity persistence bug).
3. **The debug loop** on the live stack found and fixed, beyond the plan: the
   30-minute session wedge on every ask-tier approval (the teardown waited on the
   parked call itself; the wait-list now excludes parked ids), a cross-session
   authorization bug in the durable decision read (caught live by its own
   claim-before-use guard), the approval-card argument display, PII in approval-key
   logs (now a digest), provider tool-id leaks in descriptions AND schema prose (now
   rewritten to usable keys or redacted), and a duplicate resume dispatch. Every fix
   carries a test that fails without it. Evidence:
   `/home/mahmoud/agenta-qa-evidence/2026-08-27-gateway-park-wedge/`.
4. **PRs opened**, CodeRabbit addressed, and a final security-surface review done.
5. **Post-open fixes from Mahmoud's live testing** (all on #6310):
   - `6b8c1f4573` pins the Composio toolkit version to LATEST on listing
     (`toolkit_versions`), detail (`version`), and execute (`version` in the BODY;
     the query form is silently ignored). Without it, search searched latest while
     the catalog served the account's old snapshot, so every hit died (`kept=0`) and
     agents reported their tools do not exist. Verified on Mahmoud's own run:
     `kept=0` to `kept=3` with four `googledrive.FIND_FILE` executions.
   - `4b508da9a3` teaches the commit engine to address `gateway_connection` entries
     (key `gateway_connection:{provider}:{integration}`); before it, an agent adding
     a whole integration always failed with `item_key_undefined`.
   - `56219dcca7` audits EVERY model-facing build-kit text. Headline: both worked
     examples still demonstrated per-action adds (examples outrank prose; that is
     how Mahmoud's agent produced a legacy entry), one example called an unreachable
     tool, and `list_connections` was mislabeled so agents guessed slugs instead of
     reading real ones. Two follow-on text rounds (search-once wording; seven
     commit-engine message fixes) were in flight when this page was written; check
     `git log` on the branch.

## Open items

Decisions for Mahmoud:
- The [live policy refresh proposal](live-policy-refresh.md): same-turn availability
  of an integration the agent just added. PROPOSAL status, awaiting a verdict.
- Visual token drift: nothing breaks the design; ~20 measured drifts with one likely
  shared cause (component defaults beating explicit tokens) and two copy drifts.
  Screenshots: `/home/mahmoud/agenta-qa-evidence/2026-08-27-visual-regression/`.
- QA provider keys: top up OpenAI or Anthropic for autonomous QA runs, and ROTATE the
  exposed OpenAI key (see issue #6314 below).

Filed follow-up issues, each grounded in a draft or evidence:
- [#6312](https://github.com/Agenta-AI/agenta/issues/6312) the approval dock can offer
  approvals the SDK responder cannot reach.
- [#6313](https://github.com/Agenta-AI/agenta/issues/6313) a gateway park should end
  the turn promptly instead of riding the relay timeout (design work; the wedge
  itself is fixed). Draft: [followup-gateway-park-termination.md](followup-gateway-park-termination.md).
- [#6314](https://github.com/Agenta-AI/agenta/issues/6314) the vault read endpoint
  returns provider keys in cleartext. Draft: [followup-vault-secret-read.md](followup-vault-secret-read.md).
- [#6315](https://github.com/Agenta-AI/agenta/issues/6315) the cold-replay sweep
  leaves an unanswerable approval card (pre-existing platform behavior).
  Draft: [followup-approval-wedge.md](followup-approval-wedge.md).
- [#6316](https://github.com/Agenta-AI/agenta/issues/6316) batched loopback requests
  can duplicate execution for any pausable non-client tool (pre-existing).
- Unfiled but recorded: the cross-integration `tool_not_in_integration` claim needs
  the provider integration list as a positive signal (session task #20).

Backlog, untouched by design: the always-on base layer above agents.md, auto mode
(flat-load small tool sets), query-less search modes, and the QA-gate + benchmark
rerun before ship ([release-gate-changes.md](release-gate-changes.md) holds the gate
proposal, [qa.md](qa.md) the test spec).

## How to verify anything here

The live QA script with numbered steps is in [qa.md](qa.md). The stack login and
container names are in the deploy worktree's env file
(`hosting/docker-compose/ee/.env.ee.dev.toolkit.local`). Three habits that repeatedly
saved this project, worth keeping: scope log windows to a REAL container restart
(hot reloads do not move `StartedAt`); read `[gateway] search` drop reasons before
concluding anything (`unknown`, `unconfigured`, and `denied` mean three different
things); and check `git branch --show-current` before reporting any file as unfixed,
because parallel worktrees make stale reads easy.
