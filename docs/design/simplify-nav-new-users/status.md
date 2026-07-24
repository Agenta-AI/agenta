# Status — Simplify nav for new signup users

**Last updated:** 2026-07-24

## Current stage

Split into two phases. **Phase 1** (hide the advanced nav for new signups) is **implemented** —
`advancedNavHiddenAtom` added to `state/onboarding` selectors, five `isHidden` edits in
`useSidebarConfig`; `tsc` and ESLint pass clean. Remaining Phase-1 step: manual QA (Slice 4).
**Phase 2** (a per-user "Simplified navigation" toggle in Settings → Account) is not started.

## Locked decisions

- **Phased delivery.** Phase 1 = hide-for-new-signups. Phase 2 = the Settings → Account toggle.
  Phase 2 is additive — it touches no Phase-1 file except the body of `advancedNavHiddenAtom`.
- **Hide scope: nav-only.** Remove the sidebar entries only. No route guards, no in-app link
  changes.
- **Items hidden.** Project: Prompts, Evaluation group (all four children). App: Overview,
  Registry, Evaluations.
- **Items kept.** Home, Agents, project Observability; app Playground, app Observability.
- **Default mode = a fresh forward-only key, seeded at signup.** New signups default to
  simplified; everyone else defaults to full. We do **not** reuse `isNewUserAtom`: it is
  sticky-true for everyone who ever signed up (incl. existing users), so deriving from it would
  strip advanced nav from current users. Instead a new per-user key
  `agenta:onboarding:<userId>:nav-simplified` (`navSimplifiedDefaultAtom`, default `false`) is
  written only on signups going forward, alongside `setIsNewUser(true)` in `usePostAuthRedirect`.
  Existing users never have the key → full nav, unchanged.
- **Stable seam.** The sidebar reads one derived atom `advancedNavHiddenAtom` (in the
  `state/onboarding` selectors module, alongside `deadEndNavDisabledAtom`). Phase 1:
  `= navSimplifiedDefault`. Phase 2: `= override ?? navSimplifiedDefault`. Only this atom's body
  and the five sidebar edits change; consumers never do.
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

Manual QA Phase 1 in the running app (Slice 4): flip `agenta:onboarding:<id>:nav-simplified`
true/false and confirm the five items hide/show, non-targets stay, no empty section header
remains. Then Phase 2 (Slices 5–6) as a separate delivery.

**Slice 0 note:** the automated pin was skipped — `@agenta/oss` has no CI-wired vitest runner
(the web unit layer only runs `test:unit` across `@agenta/*` packages), so a test in `oss/src`
would never execute. Covered instead by `tsc` + ESLint + manual QA. Standing up an oss vitest
harness is a possible follow-up if automated sidebar coverage is wanted.
