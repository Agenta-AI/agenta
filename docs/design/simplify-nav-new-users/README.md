# Simplify navigation for new signup users

**Status:** Planning complete — decisions locked, ready to implement
**Date:** 2026-07-24

New signup users land on the full platform sidebar, which is noise when their only goal is
building an agent. This workspace plans a nav-only simplification in two phases. **Phase 1**
hides the advanced pages (Prompts, the Evaluation group, Overview, Registry, Evaluations) for
new signups. **Phase 2** adds a per-user **"Simplified navigation"** toggle in Settings →
Account so anyone can switch back to the full view to use the LLM-app pages. Existing and
returning users default to the full view throughout.

## Decisions

- Two phases: Phase 1 = hide-for-new-signups; Phase 2 = the Settings → Account toggle
  (additive — touches no Phase-1 file except one derived atom).
- Nav-only — hide sidebar entries; no route guards, no in-app link changes.
- Hide when simplified: Prompts, Evaluation group (project); Overview, Registry, Evaluations (app).
- Keep always: Home, Agents, Observability, app Playground.
- Default mode seeded by a fresh forward-only key `navSimplifiedDefaultAtom`, written at signup
  (new signups → simplified); everyone else → full. Deliberately **not** `isNewUserAtom`, which
  is sticky-true for existing users and would strip their advanced nav.
- Stable seam: the sidebar reads one derived atom `advancedNavHiddenAtom` (in `state/onboarding`
  selectors) — Phase 1 `= navSimplifiedDefault`, Phase 2 `= override ?? navSimplifiedDefault`.
- No backend, no team-wide enforcement — per-user preference; an invited teammate flips the
  Phase-2 switch to match their team. A workspace-level flag is deferred, not blocked.
- Built on the sidebar's existing `isHidden` mechanism; one OSS sidebar file, both editions inherit it.

## Deliverables

- [context.md](./context.md) — problem, phased scope, out-of-scope, product language, success criteria.
- [research.md](./research.md) — how the sidebar, new-user state, and settings tabs work today, with `file:line`.
- [plan.md](./plan.md) — the phased, sliced implementation plan (Phase 1: Slice 0–4; Phase 2: Slice 5–6).
- [status.md](./status.md) — locked decisions, open questions, next action.

## Intended outcome

A user who has just signed up sees a focused, agent-first sidebar: Home, Agents, and
Observability at the project level, Playground + Observability inside an app. Anyone who wants
the complete platform — an existing LLM-app team, or an invited teammate — flips one switch in
Settings → Account and gets it back, with the choice remembered. No one is ever stuck in the
wrong view.
