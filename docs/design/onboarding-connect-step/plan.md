# Plan

Six work packages. Each lands and is verifiable on its own; WP-1 and WP-2 are independent
of any further visual iteration.

## WP-1 — Detection (pure)

`web/packages/agenta-entities/src/workflow/detectAccounts.ts`, exported from
`src/workflow/index.ts`.

- `DetectedAccount` type, `detectAccounts({description, template})`, and the alias table.
- Template integrations first (`required: true`), then word-boundary text matches in
  description order, deduped by slug (template wins).
- No React, no network.

Tests (`tests/unit/detectAccounts.test.ts`): brand-name hit; alias hit; word-boundary
negatives (`"hub"`, `"linear algebra"`, `"slacks"`); template merge and dedupe; ordering;
empty description; a template with zero required integrations.

**~150 LOC + ~12 cases.**

## WP-2 — The card

`web/packages/agenta-entity-ui/src/onboarding/AgentSetupCard.tsx` plus `AccountRow.tsx`,
extracted from `agent-home/components/TemplateSetupDrawer/IntegrationRow.tsx` (extract, do
not re-implement — the drawer then consumes the extracted row).

- Props: `accounts`, `onConnectedChange`, `onSkip`, `onAdd`, `permission`,
  `onPermissionChange`, `onCreate`, `creating`.
- Owns skip state and the `canCreate` predicate; connection state comes from
  `useToolIntegrationConnections` as it does today.
- `＋ Search all` opens the existing catalog search; Connect opens `ConnectDrawer`.

Tests: Create disabled while a required account is unconnected; enabled once connected;
enabled with every suggested account skipped; the skipped row's Undo restores it.

**~320 LOC.**

## WP-3 — Home first run

`agent-home/StripHome.tsx` + `hooks/useAgentHomeActions.ts`.

- Submit no longer creates. The composer settles into a quoted summary with Edit; the card
  reveals beneath it in the same column; Create moves into the card's footer.
- Behind `CONNECT_STEP_MODE`; off restores today's behaviour exactly.

**~120 LOC.**

## WP-4 — Playground onboarding

`agent-home/PlaygroundOnboarding/useAgentOnboarding.ts`.

- The same card between the composer and `commit()`. The ephemeral is already minted, so
  this only defers the commit — no new lifecycle.
- Template card clicks (`useCreateAgentFromTemplate`) route through the step too (D3).

**~90 LOC.**

## WP-5 — Carry-through

`agent-home/hooks/useCreateAgent.ts` + a pure `buildSetupPreamble` helper.

- M2: append the connected/skipped/permission lines to the seed message.
- M1 left as a documented seam behind the same `setup` argument.

Tests: preamble builder — connected only, skipped only, both, neither (returns the seed
unchanged), and permission wording per option.

**~60 LOC.**

## WP-6 — Flow tests

Per issue item 6, both flows covered.

- Free-text: description → detected accounts → gating → preamble.
- Template: declared integrations → required gating → preamble.
- Flag off: no step, `useCreateAgent` called directly.

## Verification

1. `pnpm --filter @agenta/entities test:unit` and `--filter @agenta/entity-ui test:unit`.
2. `pnpm --filter @agenta/oss exec tsc --noEmit` — gate on the error *signature diff*, not
   the count.
3. `pnpm lint-fix` in `web/`.
4. Live matrix on the dev stack: first-run free text (detected / nothing detected / already
   connected), template with required integrations, skip-everything, flag off. Light and
   dark for each. `/m` renders the extracted card without token breakage.

## Sequencing

WP-1 → WP-2 can start now and are unaffected by further mockup iteration. WP-3/WP-4 wait on
the card being real. WP-5 can land any time after WP-1. WP-6 follows each package.

## Landing

GitButler lanes over `main`, one lane per WP in dependency order, PR bases set to the lane
below. Per the root AGENTS.md rule: a test lands on the lane whose tip **first** contains
every symbol it touches — the detector tests go with WP-1, the card tests with WP-2, the
flow tests with WP-5/WP-6, never lower.
