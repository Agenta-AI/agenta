# Plan — Simplify nav for new signup users

Two phases. **Phase 1** ships the hide-for-new-signups behavior. **Phase 2** adds the
Settings → Account toggle so users can switch back to the full view (e.g. to use the LLM-app
pages). Phase 2 is designed to be **purely additive** — it touches no Phase-1 file except the
one derived atom.

## Scope

- Nav-only. No route guards, no in-app link changes. No backend. No team-wide enforcement.
- **Phase 1:** new signups (flagged by the fresh `nav-simplified` key) get the simplified
  sidebar; everyone else — including all existing users — is unaffected. No way to switch yet, so
  a genuinely-new solo user stays simplified until Phase 2. (Invited teammates are never flagged,
  so they keep the full nav — see research.md §7.)
- **Phase 2:** a per-user localStorage override + a switch in Settings → Account, so anyone can
  force simplified or full.

## The stable seam

One derived atom is the sole nav-simplify dependency the sidebar reads, so the sidebar edits are
written once (Phase 1) and never touched again. It lives in `state/onboarding/selectors.ts`
alongside the other onboarding-driven nav gates (`deadEndNavDisabledAtom`, `homeNavInertAtom`):

- **Phase 1:** `advancedNavHiddenAtom = navSimplifiedDefault` (thin passthrough over a fresh,
  forward-only per-user key).
- **Phase 2:** `advancedNavHiddenAtom = override ?? navSimplifiedDefault` (add the override; same
  name, same consumers).

**Why not reuse `isNewUserAtom`:** it is sticky-true for everyone who ever signed up (including
existing users), so deriving from it would strip the advanced nav from current users. Phase 1
instead introduces a new per-user key `agenta:onboarding:<userId>:nav-simplified`
(`navSimplifiedDefaultAtom`, default `false`) written only on signups going forward.

The sidebar reads `advancedNavHiddenAtom` with a bare `useAtomValue` (matching its sibling nav
gates); only the atom's body changes between phases.

---

# Phase 1 — Hide advanced nav for new signups

## Slice 0 — Pin the current sidebar with a test

1. Unit test over `useSidebarConfig` output (or `filterVisibleItems` on the built items)
   asserting the five target keys are **present** when `isNavSimplified === false`.
2. Assert non-targets (Home, Agents, Observability, app Playground) are present in both modes.

**Exit:** a passing test capturing the pre-change sidebar (targets + non-targets visible).

## Slice 1 — The forward-only default + the derived seam atom

1. Add the durable per-user default in `web/oss/src/lib/onboarding/atoms.ts` (reuses the
   existing per-user scoping infra — `onboardingStorageUserIdAtom`, `createScopedStorageKey`):

   ```ts
   const navSimplifiedDefaultAtomFamily = atomFamily((userId: string) =>
       atomWithStorage<boolean>(createScopedStorageKey(userId, "nav-simplified"), false),
   )

   export const navSimplifiedDefaultAtom = atom(
       (get) => {
           const userId = get(onboardingStorageUserIdAtom)
           return userId ? get(navSimplifiedDefaultAtomFamily(userId)) : false
       },
       (get, set, next: boolean) => {
           const userId = get(onboardingStorageUserIdAtom)
           if (userId) set(navSimplifiedDefaultAtomFamily(userId), next)
       },
   )
   ```

   Export it from the `lib/onboarding` barrel.

2. Seed it at signup in `web/oss/src/hooks/usePostAuthRedirect.ts`: call
   `setNavSimplifiedDefault(true)` next to each `setIsNewUser(true)` (EE and OSS non-invited
   branches). Invited users `return` before this, so they stay on full nav.

3. Add the derived seam atom to `web/oss/src/state/onboarding/selectors.ts`, next to
   `deadEndNavDisabledAtom` (imports `navSimplifiedDefaultAtom` from `@/oss/lib/onboarding/atoms`):

   ```ts
   // Phase 1: follows the signup-era default. Phase 2 adds a user override here.
   export const advancedNavHiddenAtom = atom((get) => get(navSimplifiedDefaultAtom))
   ```

   No new module or wrapper hook — consumers read it with a bare `useAtomValue`, like the
   sibling nav gates.

**Exit:** `advancedNavHiddenAtom` returns the new per-user default (not `isNewUser`); a signup
sets `nav-simplified` true; both editions compile.

## Slice 2 — Hide the two project-scope items

Edit `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx`.

1. `const hideAdvancedNav = useAtomValue(advancedNavHiddenAtom)` near the top (import the atom
   from the existing `@/oss/state/onboarding` barrel).
2. Prompts (`PROMPTS_SIDEBAR_KEY`, `:72`): add `isHidden: hideAdvancedNav`.
3. Evaluation group (`evaluation-group`, `:88`): add `isHidden: hideAdvancedNav`.
4. Add `hideAdvancedNav` to the `projectItems` `useMemo` deps.

**Exit:** with the simplified default true, `projectItems` (post `filterVisibleItems`) has no
Prompts and no `evaluation-group`; with it false, both present. Non-targets unchanged.

## Slice 3 — Hide the three app-scope items

Same file, `appItems` memo (`:144`).

1. Overview (`:147`), Registry (`:164`), Evaluations (`:174`): change `isHidden: isHidden` to
   `isHidden: isHidden || hideAdvancedNav`. Do **not** touch Playground or app Observability.
2. Add `hideAdvancedNav` to the `appItems` `useMemo` deps.

**Exit:** with the simplified default true, `appItems` (post `filterVisibleItems`) has no
Overview, Registry, or Evaluations, and still has Playground + Observability when the app-context
gate allows. With it false, all five behave exactly as before.

## Slice 4 — Manual QA (Phase 1)

1. Run the local stack (OSS + dev per root `AGENTS.md`).
2. New user: set `agenta:onboarding:active-user-id` to the user id and
   `agenta:onboarding:<id>:nav-simplified` to `true`, reload → simplified sidebar. Confirm the
   five items gone, Home/Agents/Observability/Playground remain.
3. Set `nav-simplified` to `false` (or remove the key), reload → full sidebar returns.
4. Check both the main (project) and workflow (app) sidebars.
5. Confirm no empty section header / stray divider where the Evaluation group was
   (`filterVisibleSections` drops empty sections — verify visually).

**Exit:** both states verified in the running app; `pnpm lint-fix` clean. **Phase 1 shippable.**

---

# Phase 2 — Settings → Account toggle (follow-up)

Additive. Nothing from Phase 1 changes except the body of `advancedNavHiddenAtom`.

## Slice 5 — The override state

Add the override atom (near `navSimplifiedDefaultAtom`) and extend `advancedNavHiddenAtom` in
`web/oss/src/state/onboarding/selectors.ts`:

```ts
import {atomWithStorage} from "jotai/utils"

/** null = follow default, true = force simplified, false = force full. Per-user via LS. */
export const simplifiedNavOverrideAtom = atomWithStorage<boolean | null>(
    "agenta:nav:simplified-override",
    null,
)

// Phase 2: explicit choice wins; else fall back to the signup-era default.
export const advancedNavHiddenAtom = atom((get) => {
    const override = get(simplifiedNavOverrideAtom)
    return override ?? get(navSimplifiedDefaultAtom)
})
```

Unit test: override `null` → `navSimplifiedDefault`; override `true`/`false` → that value.

**Exit:** derived atom follows the table in `context.md`, proven by the test. Sidebar behavior
from Phase 1 is unchanged when no override is set.

## Slice 6 — The switch

1. Add `web/oss/src/components/pages/settings/Account/NavigationPreference.tsx`: an antd `Switch`
   labeled "Simplified navigation" with a one-line description ("Hide advanced features —
   Prompts, Evaluations, Registry — for a focused agent workspace"). `checked` reads
   `advancedNavHiddenAtom`; `onChange` writes the boolean to `simplifiedNavOverrideAtom`.
2. Render it in the Account tab, above `DeleteAccount`, at
   `pages/w/[workspace_id]/p/[project_id]/settings/index.tsx:171` (`case "account"`).

**Exit:** toggling shows/hides the advanced items live (no reload); the choice survives a
reload; both directions verified. Non-new users can now opt into simplified, and new users can
reveal everything.

---

## Files touched

**Phase 1**
- `web/oss/src/lib/onboarding/atoms.ts` — new `navSimplifiedDefaultAtom` + family + storage key.
- `web/oss/src/lib/onboarding/index.ts` — export `navSimplifiedDefaultAtom` from the barrel.
- `web/oss/src/hooks/usePostAuthRedirect.ts` — seed the default at signup (two call sites).
- `web/oss/src/state/onboarding/selectors.ts` — new `advancedNavHiddenAtom` (passthrough seam),
  next to `deadEndNavDisabledAtom`.
- `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx` — five `isHidden` edits +
  `useAtomValue(advancedNavHiddenAtom)` + two dep-array entries.

**Phase 2**
- `web/oss/src/state/onboarding/selectors.ts` — add `simplifiedNavOverrideAtom`, extend
  `advancedNavHiddenAtom`.
- `web/oss/src/components/pages/settings/Account/NavigationPreference.tsx` — new switch.
- `web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx` — render the switch in
  the `account` case.

No changes to `engine/` or `scopes/`, or any EE file, in either phase.

## Rollback

Phase 1: revert `advancedNavHiddenAtom`, `navSimplifiedDefaultAtom` + signup seed, the sidebar
`useAtomValue` read, and the five `isHidden` edits — pure code revert, no data migration, no
server state. The harmless `agenta:onboarding:<userId>:nav-simplified` localStorage key can be
left. Phase 2: delete the switch + settings render and revert `advancedNavHiddenAtom` to the
passthrough; the harmless `agenta:nav:simplified-override` localStorage key can be left.
