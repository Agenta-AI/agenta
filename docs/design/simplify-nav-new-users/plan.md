# Plan — Simplify nav for new signup users

Two phases. **Phase 1** ships the hide-for-new-signups behavior. **Phase 2** adds the
Settings → Account toggle so users can switch back to the full view (e.g. to use the LLM-app
pages). Phase 2 is designed to be **purely additive** — it touches no Phase-1 file except the
one derived atom.

## Scope

- Nav-only. No route guards, no in-app link changes. No backend. No team-wide enforcement.
- **Phase 1:** new signups (`isNewUser`) get the simplified sidebar; everyone else is
  unaffected. No way to switch yet — a genuinely-new solo user stays simplified until Phase 2.
  (Invited teammates already read `isNewUser === false`, so they keep the full nav — see
  research.md §7.)
- **Phase 2:** a per-user localStorage override + a switch in Settings → Account, so anyone can
  force simplified or full.

## The stable seam

One derived atom is the sole dependency of the sidebar hook, so the sidebar edits are written
once (Phase 1) and never touched again:

- **Phase 1:** `isNavSimplifiedAtom = isNewUser` (thin passthrough).
- **Phase 2:** `isNavSimplifiedAtom = override ?? isNewUser` (add the override; same name, same
  consumers).

The hook `useHideAdvancedNav` reads `isNavSimplifiedAtom` in both phases and never changes.

---

# Phase 1 — Hide advanced nav for new signups

## Slice 0 — Pin the current sidebar with a test

1. Unit test over `useSidebarConfig` output (or `filterVisibleItems` on the built items)
   asserting the five target keys are **present** when `isNavSimplified === false`.
2. Assert non-targets (Home, Agents, Observability, app Playground) are present in both modes.

**Exit:** a passing test capturing the pre-change sidebar (targets + non-targets visible).

## Slice 1 — The derived atom + hook

1. Add `web/oss/src/state/navPreference/atoms.ts`:

   ```ts
   import {isNewUserAtom} from "@/oss/lib/onboarding"
   import {atom} from "jotai"

   // Phase 1: simplified nav follows new-signup status. Phase 2 adds a user override here.
   export const isNavSimplifiedAtom = atom((get) => get(isNewUserAtom))
   ```

2. Add `web/oss/src/components/Sidebar/hooks/useHideAdvancedNav.ts`:

   ```ts
   import {useAtomValue} from "jotai"
   import {isNavSimplifiedAtom} from "@/oss/state/navPreference/atoms"

   /** Advanced sidebar areas are hidden while the simplified view is active. */
   export const useHideAdvancedNav = (): boolean => useAtomValue(isNavSimplifiedAtom)
   ```

**Exit:** `isNavSimplifiedAtom` returns `isNewUser`; hook compiles and is unit-referenced.

## Slice 2 — Hide the two project-scope items

Edit `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx`.

1. `const hideAdvancedNav = useHideAdvancedNav()` near the top.
2. Prompts (`PROMPTS_SIDEBAR_KEY`, `:72`): add `isHidden: hideAdvancedNav`.
3. Evaluation group (`evaluation-group`, `:88`): add `isHidden: hideAdvancedNav`.
4. Add `hideAdvancedNav` to the `projectItems` `useMemo` deps.

**Exit:** with `isNewUser` true, `projectItems` (post `filterVisibleItems`) has no Prompts and
no `evaluation-group`; with it false, both present. Non-targets unchanged.

## Slice 3 — Hide the three app-scope items

Same file, `appItems` memo (`:144`).

1. Overview (`:147`), Registry (`:164`), Evaluations (`:174`): change `isHidden: isHidden` to
   `isHidden: isHidden || hideAdvancedNav`. Do **not** touch Playground or app Observability.
2. Add `hideAdvancedNav` to the `appItems` `useMemo` deps.

**Exit:** with `isNewUser` true, `appItems` (post `filterVisibleItems`) has no Overview,
Registry, or Evaluations, and still has Playground + Observability when the app-context gate
allows. With it false, all five behave exactly as before.

## Slice 4 — Manual QA (Phase 1)

1. Run the local stack (OSS + dev per root `AGENTS.md`).
2. New user: set `agenta:onboarding:active-user-id` to the user id and
   `agenta:onboarding:<id>:is-new-user` to `true`, reload → simplified sidebar. Confirm the
   five items gone, Home/Agents/Observability/Playground remain.
3. Set `is-new-user` to `false`, reload → full sidebar returns.
4. Check both the main (project) and workflow (app) sidebars.
5. Confirm no empty section header / stray divider where the Evaluation group was
   (`filterVisibleSections` drops empty sections — verify visually).

**Exit:** both states verified in the running app; `pnpm lint-fix` clean. **Phase 1 shippable.**

---

# Phase 2 — Settings → Account toggle (follow-up)

Additive. Nothing from Phase 1 changes except the body of `isNavSimplifiedAtom`.

## Slice 5 — The override state

Edit `web/oss/src/state/navPreference/atoms.ts`:

```ts
import {atomWithStorage} from "jotai/utils"

/** null = follow default, true = force simplified, false = force full. Per-user via LS. */
export const simplifiedNavOverrideAtom = atomWithStorage<boolean | null>(
    "agenta:nav:simplified-override",
    null,
)

// Phase 2: explicit choice wins; else fall back to new-signup default.
export const isNavSimplifiedAtom = atom((get) => {
    const override = get(simplifiedNavOverrideAtom)
    return override ?? get(isNewUserAtom)
})
```

Unit test: override `null` → `isNewUser`; override `true`/`false` → that value.

**Exit:** derived atom follows the table in `context.md`, proven by the test. Sidebar behavior
from Phase 1 is unchanged when no override is set.

## Slice 6 — The switch

1. Add `web/oss/src/components/pages/settings/Account/NavigationPreference.tsx`: an antd `Switch`
   labeled "Simplified navigation" with a one-line description ("Hide advanced features —
   Prompts, Evaluations, Registry — for a focused agent workspace"). `checked` reads
   `isNavSimplifiedAtom`; `onChange` writes the boolean to `simplifiedNavOverrideAtom`.
2. Render it in the Account tab, above `DeleteAccount`, at
   `pages/w/[workspace_id]/p/[project_id]/settings/index.tsx:171` (`case "account"`).

**Exit:** toggling shows/hides the advanced items live (no reload); the choice survives a
reload; both directions verified. Non-new users can now opt into simplified, and new users can
reveal everything.

---

## Files touched

**Phase 1**
- `web/oss/src/state/navPreference/atoms.ts` — new, `isNavSimplifiedAtom` (passthrough).
- `web/oss/src/components/Sidebar/hooks/useHideAdvancedNav.ts` — new, ~4 lines.
- `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx` — five `isHidden` edits +
  hook call + two dep-array entries.
- Sidebar visibility test (new or extended).

**Phase 2**
- `web/oss/src/state/navPreference/atoms.ts` — add `simplifiedNavOverrideAtom`, extend the
  derived atom.
- `web/oss/src/components/pages/settings/Account/NavigationPreference.tsx` — new switch.
- `web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx` — render the switch in
  the `account` case.

No changes to `engine/`, `scopes/`, `lib/onboarding/`, or any EE file, in either phase.

## Rollback

Phase 1: delete the two new files, the hook call, and the five `isHidden` edits — pure code
revert, no data migration, no server state. Phase 2: delete the switch + settings render and
revert the derived atom to the passthrough; the harmless `agenta:nav:simplified-override`
localStorage key can be left.
