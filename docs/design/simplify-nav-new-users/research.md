# Research — how the sidebar and new-user state work today

All line references are current at the time of writing.

## 1. One file owns every target item

`web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx` builds two arrays:

- `projectItems` (project scope) — `web/.../useSidebarConfig/index.tsx:52`
- `appItems` (app scope) — `web/.../useSidebarConfig/index.tsx:144`

`projectItems` feeds the main sidebar via `mainScope.tsx:48`. `appItems` feeds the workflow
sidebar via `workflowItems.ts:29`. No EE file overrides `useSidebarConfig`, `mainScope`, or
`workflowItems` (verified with `find ee/src`), so a single OSS change reaches both editions.

### Target items and their exact lines

| Item | Scope | Key | Line |
| --- | --- | --- | --- |
| Prompts | project | `PROMPTS_SIDEBAR_KEY` | `:72` |
| Evaluation (whole group) | project | `evaluation-group` | `:88` |
| Overview | app | `overview-link` | `:147` |
| Registry | app | `app-variants-link` | `:164` |
| Evaluations | app | `app-evaluations-link` | `:174` |

The Evaluation group at `:88` is a single item with a `submenu` (Test sets, Evaluators,
Evaluation runs, Annotation Queues). Hiding the group hides all four children.

## 2. The `isHidden` mechanism already does exactly what we need

`SidebarConfig.isHidden` (`engine/types.ts:12`) is honored by
`engine/visibility.ts:filterVisibleItems`:

```ts
items.flatMap((item) =>
    item.isHidden ? [] : [{...item, submenu: item.submenu ? filterVisibleItems(item.submenu) : undefined}])
```

It runs recursively and drops flagged items at every level, so a hidden item never renders,
never auto-opens, and never becomes the selected key. `filterVisibleSections` then drops any
section left empty. This is the sanctioned seam — set `isHidden` and the engine does the rest.

**Seam detail:** `projectItems` targets (Prompts, evaluation-group) have no `isHidden` today,
so we add one. `appItems` targets already carry `isHidden` bound to the app-context gate
`const isHidden = !hasAppContext && !currentApp && !recentlyVisitedAppId` (`:145`). We must
**OR** our condition onto that existing value, not overwrite it, or we would re-show items
that the app-context gate intends to hide.

## 3. The "new user + localStorage" infrastructure already exists — reuse it

`web/oss/src/lib/onboarding/atoms.ts`:

- `isNewUserAtom` (`:45`) reads/writes a per-user, localStorage-backed value under
  `agenta:onboarding:${userId}:is-new-user` (`atomWithStorage`, `:22`).
- It returns `false` when `onboardingStorageUserIdAtom` (`:14`, LS key
  `agenta:onboarding:active-user-id`) is unset.

Lifecycle, verified by grep:

- **Set `true`** on first signup in `web/oss/src/hooks/usePostAuthRedirect.ts:136` (EE) and
  `:147` (OSS), driven by `is_new_user` in the SuperTokens session payload.
- **Set `false`**: nowhere. `grep` for `setIsNewUser(false)` / `isNewUser(false)` returns no
  call. The atom's own doc comment claims it flips on tour completion, but that code path does
  not exist. So today the flag is **sticky-true per browser** once a user signs up.
- `onboardingStorageUserIdAtom` is set for every authed user (`usePostAuthRedirect.ts:114`),
  but `isNewUser` is only *written* when the payload says new. A returning user on a fresh
  browser therefore reads the family default `false` → full nav. Only genuine fresh signups
  read `true`.

Already consumed the same way by observability onboarding
(`components/pages/observability/components/{ObservabilityTable,SessionsTable}/index.tsx`) and
the onboarding widget, so `useAtomValue(isNewUserAtom)` inside a hook is an established pattern.

## 4. One interaction, not a current blocker

`components/Onboarding/tours/firstEvaluationTour.ts:188` targets
`selector: '[data-tour="evaluations-nav"]'` — the app-scope Evaluations item we will hide.
But the whole tour engine is parked: `lib/onboarding/constants.ts:8` sets
`ONBOARDING_TOURS_ENABLED = false`, and the tour is registered/started only under that flag
(`Playground/PlaygroundOnboarding.tsx:23`). So there is no live conflict today.
`deployPromptTour.ts:33` references the Registry nav item but the selector is commented out.

**Follow-up (not this delivery):** if tours are re-enabled, `firstEvaluationTour` must either
not run for new users or not depend on the hidden nav item.

## 5. SSR / hydration note

`atomWithStorage` hydrates from localStorage on the client. During SSR and first paint the
value is the default (`false`), so a new user could see the advanced items for one frame
before they disappear on hydration. This matches the existing observability-onboarding
behavior (same atom, same pattern), so it is acceptable for the MVP. If the flash is
objectionable, `atomWithStorage(..., {getOnInit: true})` or gating render on a
mounted/hydrated flag are the standard fixes — noted, not required.

## 6. The settings surface for the toggle already exists

Settings tabs are declared in
`web/oss/src/components/pages/settings/assets/navigation.ts`. There is already an `account`
tab (`SettingsTabKey`), and its content renders at
`web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx:171` —
`case "account": ... content: <DeleteAccount />`. The Account content folder
(`components/pages/settings/Account/`) currently holds only `DeleteAccount.tsx`, so it is a
clean place to add a "Simplified navigation" switch above the delete-account block.

## 7. Per-user vs per-workspace — why the toggle is the chosen shape

The intent ("simplify for agent-focused people") is really a per-*workspace* property, but the
only ready signal (`isNewUser`) and the chosen storage (localStorage) are per-*user*. A per-user
preference therefore cannot force a whole team to match. Verified consequence in the invite flow:
`usePostAuthRedirect.ts` calls `setIsNewUser(true)` only in the **non-invited** branches
(`:136`, `:147`); an invited teammate returns at `:128–:131` before the flag is set, so they read
`isNewUser === false` → full nav, even when the inviter (a fresh agent signup) sees the simplified
nav. The toggle resolves this at the individual level: the teammate flips one switch to match.
Team-wide enforcement would require a workspace-level flag (backend), which is deferred.

## Seams to pin in the plan

1. A per-user preference atom `simplifiedNavOverrideAtom` (`boolean | null`, localStorage) plus
   a derived `isNavSimplifiedAtom = override ?? isNewUser`. One value, two consumers.
2. `projectItems`: Prompts and evaluation-group need a new `isHidden` bound to
   `isNavSimplifiedAtom`.
3. `appItems`: Overview, Registry, Evaluations need `isHidden` **OR-ed** with the existing
   app-context `isHidden`, not replaced.
4. The condition must reach the sidebar through a single hook/selector so it lives in one place.
5. Non-targets (Home, Agents, Observability, Playground) must remain untouched.
6. The Settings → Account switch reads and writes the same preference, so the sidebar and the
   switch never disagree.
