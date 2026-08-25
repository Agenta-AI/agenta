# Status

Last updated: 2026-08-24.

## Where things stand

- Design iteration 1 published and reviewed. **D1–D7 locked** (see `context.md`): iteration
  B (inline reveal), text detection never gates, template clicks route through the step,
  new `NEXT_PUBLIC_AGENT_CONNECT_STEP` flag, M2 carry-through now, package placement,
  drawer kept for this round.
- **WP-1 DONE, uncommitted.** `web/packages/agenta-entities/src/workflow/detectAccounts.ts`
  and `tests/unit/detectAccounts.test.ts`, exported from `src/workflow/index.ts`. 18 cases.
- **WP-2 DONE, uncommitted.** `@agenta/entity-ui/onboarding` — `AgentSetupCard`, `AccountRow`,
  `copy.ts`, plus the rules module `@agenta/entities/workflow/agentSetup.ts` (gating **and**
  WP-5's preamble builder, both pure). `AccountRow` was *extracted* from
  `TemplateSetupDrawer/IntegrationRow.tsx`, which is deleted — the drawer now renders the
  extracted row off `detectAccountsFromTemplate`, so both surfaces show one row.
- **WP-3 DONE, uncommitted.** Home first run: submit opens the step instead of creating; the
  description settles into a line with Edit; the card renders below it and the template strip
  hides while the step is open. A template card click opens the step too (D3).
- **WP-4 DONE, uncommitted.** Playground onboarding: `commit()` now opens the step and
  `commitWithSetup(selection)` does the real commit. The card docks above the composer, where the
  strip sits and where the agent's own mid-run connect card appears.
- **WP-5 DONE, uncommitted.** `useCreateAgent` takes `setup` and appends the preamble to the seed.
- **WP-6 DONE, uncommitted.** `tests/unit/onboardingConnectFlow.test.ts` covers both flows.
- Flag: `NEXT_PUBLIC_AGENT_CONNECT_STEP` (`CONNECT_STEP_MODE`), default on.

## Verified

- `@agenta/entities`: 1396/1396 unit tests pass (43 new).
- `@agenta/entity-ui`: 484/484 pass (11 new gating tests).
- `tsc --noEmit` clean on `@agenta/entities`, `@agenta/entity-ui`, `@agenta/oss` and `@agenta/ee`
  (0 errors each).
- `pnpm lint-fix` clean across all 25 workspace packages.
- **Not run in a browser.** No visual, dark-mode, or `/m` pass yet.

## Decisions taken during implementation

- **`AgentSetupCard.onCreate` hands back the whole selection.** Which accounts are connected is
  known only inside the card (each row reads its own workspace connection), so making the host
  track it a second time would have been two sources of truth for the thing the gate depends on.
- **Skip is structurally unavailable on a required row** — `onSkip` is passed as `undefined` when
  `account.required`, so D2 holds in the props, not just in the rendering.
- **The playground path no longer fakes a sent turn when the step opens.** `handleCreateAgent`
  used to set the optimistic first turn and clear the composer before committing; with the step
  that would show a message as sent while the user is still in setup. It now leaves the composer
  alone, and the existing `committingSeed` effect picks the turn up when the step actually commits.
- **The permission answer is sent even with zero accounts** when it is non-default: "read only"
  constrains an agent that needs no account at all.

## D5 revised — M1 is not viable, and that is settled

Investigated rather than assumed. A connected-app tool is **per-action**:
`{type: "gateway", provider, integration, action, connection}`, and `parseGatewayTool` returns
`null` without `action` (`entity-ui/DrillInView/SchemaControls/toolUtils.ts:53`). There is no
toolkit-level tool object, and `permission` is a field *on a tool*. The setup step knows the
integration and has no basis to choose `GITHUB_CREATE_ISSUE` over `GITHUB_LIST_ISSUES` — that is
what the builder's `discover_tools` is for. Writing guessed actions into the config would be
worse than writing none.

So **M2 is the carry-through permanently**, not a stopgap. Since the preamble is therefore
always visible in the first turn (the seed is auto-sent as the user's own message, and
`AgentFirstRunSeed` carries text only), it is now written in the **user's voice**:

> Triage new GitHub issues and post a daily digest to Slack.
>
> I've connected GitHub. I've skipped Slack for now — ask me when you need it. Ask me before you
> write or send anything.

Nothing is appended when the user connects nothing and keeps the default posture.

## Open — needs your call

- **Is the visible line acceptable?** If not, the only remaining option is a hidden context
  channel on the seed, which means plumbing through `@agenta/chat`'s send path and
  `agentRequest` — bigger than this issue, and it needs the runner contract's agreement.
- **Browser QA has not run.** `qa.md` is the matrix; it needs your dev stack.

## What WP-1 turned out to need

Word-boundary matching alone was not enough. Three provider names are ordinary English, and
"linear algebra", "the notion that" and "cut some slack" are all whole-word hits. The
detector carries a small `NEGATIVE_CONTEXT` table keyed by slug, checked against a 24-char
window either side of the match. It keys only on the idiomatic readings — a bare leading
article is not a rejection, so "the Notion database" and "the Slack channel" still match.
Both directions are covered by tests.

## Open

- **D5/M1** — the config-write carry-through needs the agent tool-item shape confirmed with
  Mahmoud. M2 (seed preamble) ships without it; M1 is a documented seam.
- **S5** — a pre-commit planning turn from the builder would replace text detection
  entirely. Out of scope here; the `DetectedAccount[]` contract is the seam.
- The alias table is a first pass. It should be revisited against real
  `first_agent_intent` composer text once the step is live — that event already captures
  the description (truncated to 500 chars).

## Next steps

1. WP-2 — `AgentSetupCard` + `AccountRow` in `@agenta/entity-ui`, extracted from
   `TemplateSetupDrawer/IntegrationRow.tsx`.
2. WP-3 / WP-4 — mount it on the two surfaces behind the flag.
3. WP-5 / WP-6 — carry-through and flow tests.
4. Live matrix per `plan.md`, light and dark, plus `/m`.

## Not verified

Nothing is committed and nothing has been run in a browser. WP-1 is covered by unit tests
only.
