# Status — Simplify nav for new signup users

**Last updated:** 2026-07-24

## Current stage

Planning complete, split into two phases. **Phase 1** (ship now): hide the advanced nav for
new signups. **Phase 2** (follow-up): a per-user "Simplified navigation" toggle in
Settings → Account. No code written. Ready to implement Phase 1 on its own branch.

## Locked decisions

- **Phased delivery.** Phase 1 = hide-for-new-signups. Phase 2 = the Settings → Account toggle.
  Phase 2 is additive — it touches no Phase-1 file except the body of `isNavSimplifiedAtom`.
- **Hide scope: nav-only.** Remove the sidebar entries only. No route guards, no in-app link
  changes.
- **Items hidden.** Project: Prompts, Evaluation group (all four children). App: Overview,
  Registry, Evaluations.
- **Items kept.** Home, Agents, project Observability; app Playground, app Observability.
- **Default mode = seeded by `isNewUser`.** New signups default to simplified; everyone else
  defaults to full. No new signup-time storage — reuse `isNewUserAtom`.
- **Stable seam.** The sidebar hook `useHideAdvancedNav` reads one derived atom
  `isNavSimplifiedAtom`. Phase 1: `= isNewUser`. Phase 2: `= override ?? isNewUser`. The hook
  and the five sidebar edits are written once and never change.
- **Phase 1 has no escape hatch (accepted).** A genuinely-new solo user stays simplified until
  Phase 2. Acceptable because that user is exactly the target audience and Phase 2 follows;
  invited teammates already see the full nav (not flagged).
- **Phase 2 override.** A per-user localStorage `simplifiedNavOverrideAtom`
  (`null | true | false`); switch in **Settings → Account**. Graduation becomes manual, anytime.
- **No backend, no team-wide enforcement.** Per-user preference. An invited teammate flips the
  switch (Phase 2) to match the team; we do not force a whole workspace to one mode. A
  workspace-level flag (backend) would, and is deferred; the override model does not block it.
- **Mechanism: the existing `isHidden` flag** + `filterVisibleItems` engine. No engine change.
- **App-scope OR-ing.** Overview/Registry/Evaluations: OR the condition onto the existing
  app-context `isHidden`, do not replace it.
- **One OSS sidebar file** changes; both editions inherit it (no EE fork exists).
- **Parked tour: no action.** Tours stay disabled (`ONBOARDING_TOURS_ENABLED = false`), so
  `firstEvaluationTour`'s reference to the hidden Evaluations item is a non-issue.
- **Empty sections: filter them out.** `filterVisibleSections` already drops zero-item
  sections; QA confirms nothing residual renders.
- **Override scope (Phase 2): global-per-browser.** One `agenta:nav:simplified-override` key,
  not per-user. Accepted the shared-browser leak as negligible for MVP.
- **SSR/hydration flash: accept and judge in QA.** Ship as-is; only reach for `getOnInit` /
  a hydrated-gate if the one-frame flash actually looks bad.

## Open implementation questions

None. All resolved (2026-07-24). Ready to build.

## Next action

Implement Phase 1, Slice 0 (pin current sidebar with a test) on a fresh branch, then
Slices 1–4. Phase 2 (Slices 5–6) follows as a separate delivery.
