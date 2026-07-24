# Context — Simplify navigation for new signup users

## Problem

The sidebar exposes the full platform to everyone the moment they sign up. For a brand-new
user whose only goal is building an agent, that surface is noise: Prompts, the whole
Evaluation group, Registry, Evaluations, and the app Overview are pages the agent flow does
not need yet. They add cognitive load and lead to dead-end or empty pages during the first
session.

The product has pivoted to agent building (see `docs/design/onboarding-revamp/HANDOFF.md`).
The navigation should match that focus for people arriving new — while still letting anyone
who needs the full platform switch to it.

## Scope

Nav-only. The entries disappear from the sidebar; nothing else changes. Delivered in two
phases.

**Advanced items hidden when the simplified view is active:**

Project scope (`projectItems` in `useSidebarConfig`):
- Prompts
- Evaluation — the entire group (Test sets, Evaluators, Evaluation runs, Annotation Queues)

App scope (`appItems` in `useSidebarConfig`):
- Overview
- Registry
- Evaluations

Everything else always stays: Home, Agents, project Observability; app Playground and app
Observability.

### Phase 1 (this delivery) — hide for new signups

New signup users (`isNewUser === true`) get the simplified sidebar. Everyone else is
unaffected. There is no switch yet, so a genuinely-new solo user stays simplified until
Phase 2 ships. Invited teammates already read `isNewUser === false` (see research.md §7), so
they keep the full nav.

### Phase 2 (follow-up) — the toggle

A "Simplified navigation" switch in **Settings → Account**, backed by a per-user localStorage
override. It flips the mode either way: a new user can reveal everything (e.g. to use the
LLM-app pages), and an existing user or invited teammate can opt into the focused view. Phase 2
is additive — it changes no Phase-1 file except the one derived atom.

## Out of scope (both phases)

- **Route guards.** Direct URLs (`/prompts`, `/evaluations`, `/apps/[id]/overview`,
  `/apps/[id]/variants`, `/apps/[id]/evaluations`) still resolve. We only remove the nav
  entry points.
- **In-app links.** Buttons or cards elsewhere that navigate to a hidden page keep working.
- **Team-wide enforcement.** The preference is per-user, not per-workspace. An agent team's
  invited teammate defaults to the full view and (in Phase 2) flips the switch to match the
  team; we do not force every member to the same mode. A workspace-level flag would do that,
  but it needs a backend field and is deferred. The override model does not block adding it.
- **A backend field.** No server change in either phase. Everything is client-side localStorage.

## Product language

- **New signup user** — a user for whom `isNewUserAtom` is `true`. Set once on first signup,
  persisted per-user in localStorage, never cleared today.
- **Simplified navigation** — the reduced, agent-focused sidebar (advanced items hidden).
- **Full navigation** — the complete sidebar (today's behavior).
- **Simplified-nav preference** — the per-user override (`simplifiedNavOverrideAtom`):
  `null` = follow the default, `true` = force simplified, `false` = force full.
- **Effective mode** — `override ?? isNewUser`, exposed as `isNavSimplifiedAtom`. This single
  value drives both the sidebar and the settings switch.

## Success criteria

**Phase 1**
1. A new signup user sees the simplified sidebar (no Prompts, Evaluation group, Overview,
   Registry, or Evaluations).
2. An existing/returning user sees the full sidebar exactly as before.
3. Both editions (OSS and EE) get the behavior from one sidebar change — no EE fork.
4. Hidden items never render, auto-open, or become the selected key while simplified.
5. No backend change is introduced.

**Phase 2**
6. The Settings → Account switch flips the effective mode in either direction and survives a
   reload.
7. Toggling the switch updates the sidebar without a full page reload.
8. Phase 1's sidebar behavior is unchanged when no override is set.
