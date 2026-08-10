# Plan: make `/m` settings navigation match OSS, and put the nested rail behind a flag

## Why

The nested settings side-panel on `/m` is contested inside the team. Rather than keep arguing
it or throw the work away, **make the OSS pattern the default and keep the nested one alive
behind an env var.** Nobody has to relitigate, and the code stays.

## The two patterns

**OSS — takeover (this becomes the default).** The main sidebar *is* the settings nav.
Its header turns into `← Back`, its sections become Project / Organization / Personal with an
icon per row, and the footer keeps Invite Teammate / Help & Docs / the project switcher. At `lg`
and up there is **no in-page top bar** — the content pane starts directly with the tab title
("Members" / "Manage members, invitations, and access."). Second screenshot in the thread.

Below `lg` the sidebar is a **drawer**, so "no top bar" cannot apply there: the top bar is what
holds the drawer trigger. See step 3.

**`/m` — nested (this goes behind the flag).** The main rail (Home / Sessions / Agents) stays
put, a *second* rail appears next to it with the settings groups, and a "Settings" top bar sits
above the content. Three levels of chrome for one page. First screenshot.

## Requested outcome

1. Default `/m` behaviour == OSS takeover: settings replaces the main sidebar, and the in-page top
   bar is removed **at `lg` and up**. Below `lg` a minimal header stays, carrying the `NavDrawer`
   trigger — without it the drawer has nothing to open it and phone users lose the settings nav
   entirely.
2. Nested rail stays reachable behind `NEXT_PUBLIC_SETTINGS_NESTED_NAV=true`.
3. OSS/EE unchanged — they already do the takeover.

## Status

Steps 1–4 are **implemented**, on the `pkg/settings-ee-pages` lane (PR **#5892**):

| step | landed as |
|---|---|
| 1. the flag | `web/mobile/src/features/settings/nestedNav.ts` |
| 2. shared scope | `web/packages/agenta-settings/src/sidebar.tsx` + `mobile/src/features/settings/settingsNavScope.tsx` |
| 3. takeover | `SettingsScreen.tsx` — `AppShell scope={nestedNav ? undefined : settingsScope}`, `lg:hidden` header keeps the `NavDrawer` trigger |
| 4. nested path | `SettingsTabRail` still renders, behind the flag |

What remains is the browser pass under **Verification** — none of it has been looked at at either
breakpoint. Read the rest as the rationale for what is there, not as work to do.

## Where the pieces are

Everything is in the `sessions-ux` worktree, branch `pkg/settings-spine`. Run from `web/`.

**OSS already implements the takeover you are copying — read it first, don't redesign it:**
- `oss/src/components/Sidebar/scopes/settingsScope.tsx` — builds a `SidebarScope` with
  `SETTINGS_SIDEBAR_SCOPE_ID`, groups from `SETTINGS_SCOPES`, one Phosphor icon per tab, and
  the tabs from `getSettingsSidebarTabs(access)`. **The icon map lives here** — it is the one
  thing `/m` is missing and should be shared rather than copied (see step 2).
- `oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx` — the page. Note it
  renders `SettingsPageShell` with a title/description and no top bar.

**`/m` currently hand-rolls its nested rail:**
- `mobile/src/features/settings/SettingsScreen.tsx` — the `<nav>` block (~line 230) renders
  the groups; above it, `ScreenScaffold`'s `header` renders the `NavDrawer` + an `<h1>Settings</h1>`.
  The `<nav>` block goes behind the flag; the header becomes `lg:hidden` rather than disappearing,
  because it carries the drawer trigger (see step 3).
- `mobile/src/features/nav/mobileNavScope.tsx` — mobile's `SidebarScope` for the shared
  `SidebarShell`. This is where a settings scope belongs, mirroring `settingsScope.tsx`.
- `mobile/src/features/nav/{AppShell,NavDrawer,NavRail}.tsx` — the shell that would host it.

**Shared contracts:** `@agenta/navigation` (`SidebarScope`, `SidebarSection`,
`SidebarSelection`, `SETTINGS_SIDEBAR_SCOPE_ID`) and `@agenta/settings`
(`SETTINGS_SCOPES`, `getSettingsSidebarTabs`, `resolveSettingsTab`, `isSettingsTabKey`).

## Steps

### 1. Add the flag

Follow the existing idiom exactly — `mobile/src/features/chat/steer.ts` is the model:

```ts
// mobile/src/features/settings/nestedNav.ts
import {getEnv} from "@/lib/env"

/** Nested settings rail (a second rail beside the main one). OFF: settings takes over the
 *  main sidebar, matching oss/ee. */
export const isNestedSettingsNavEnabled = (): boolean =>
    (getEnv("NEXT_PUBLIC_SETTINGS_NESTED_NAV") || "").toLowerCase() === "true"
```

Register it wherever mobile's other `NEXT_PUBLIC_*` flags are declared for the runtime env
(check `mobile/src/lib/env.ts` and the docker-compose env files under
`hosting/docker-compose/`; `NEXT_PUBLIC_AGENT_CHAT_STEER` shows the full path a flag takes).

### 2. Share the settings scope instead of copying it

**Do not duplicate `settingsScope.tsx` into mobile.** That is the mistake this codebase has a
hard rule against — extract, never hand-roll a second version.

Move the reusable core into `@agenta/settings` (it is headless — icons, groups, tab list) and
leave the app-coupled parts (`useSettingsAccess`, `useQueryParam`, `settingsTabAtom`) in each
host. Concretely:

- `packages/agenta-settings/src/sidebar.tsx` (new): the tab→icon map and a
  `buildSettingsSidebarSections(tabs, activeTab)` returning `SidebarSection[]`. (`.tsx`, not
  `.ts` — the icon map holds JSX elements.)
- `oss/.../settingsScope.tsx` keeps its hooks and calls the shared builder.
- `mobile/src/features/settings/settingsNavScope.tsx` (new): same builder, mobile's routing.

`SETTINGS_SCOPES` and `getSettingsSidebarTabs(access)` are already shared — the grouping and
labels must keep coming from there so the two rails cannot drift.

### 3. Takeover on `/m` (the default path)

When the flag is off:

- The sidebar renders the settings scope instead of `mobileNavScope` — header becomes
  `← Back` (returns to the last non-settings route), footer unchanged.
- **At `lg` and up**, `ScreenScaffold` gets **no** `header` — the `NavDrawer` +
  `<h1>Settings</h1>` row goes away and the content pane renders `SettingsPageShell` alone,
  exactly as OSS does.
- **Below `lg` the header survives.** The sidebar is a drawer at phone widths, and the header is
  the only thing that opens it: removing it unconditionally strands a phone user on whichever
  settings tab they landed on, with no way back to the nav. Keep an `lg:hidden` header rendering
  the `NavDrawer` trigger — passing it the *settings* scope, so the drawer opens the settings nav
  and not the app nav — with "Settings" beside it (a lone icon button reads as stray chrome; the
  tab's own title is the page heading directly underneath). In JSX terms this header is
  conditional on the **breakpoint**, not on the flag.
- So "takeover" means: **at `lg`+** the persistent rail's *contents* become the settings nav and
  the top bar disappears; **below `lg`** the *drawer's* contents become the settings nav and a
  trigger-only header remains. The content pane is full-width either way. Check both breakpoints
  — `lg:` is where OSS's rail becomes persistent.

When the flag is on: today's nested rail, unchanged.

### 4. Keep the nested path working

Do not delete the `<nav>` block — move it behind the flag so both render paths compile and
are exercisable. A reviewer should be able to flip one env var and see the other pattern.

## Constraints

- **Mobile hard rules** (`web/mobile/CLAUDE.md`): no antd ever, no `@/oss` or `@agenta/ee`
  imports, one component per file, semantic tokens only (`bg-background`,
  `text-muted-foreground`), motion via `useMotionPresets()`.
- **OSS/EE must not change behaviour.** They already do the takeover; step 2 refactors where
  the icon map lives, nothing user-visible. Diff the OSS settings page before/after.
- The settings tab list, grouping and labels stay driven by `@agenta/settings` for both hosts.

## Verification

Save as a file and run with `bash` — `set -e` in an interactive shell exits it on the first failure.

```bash
set -euo pipefail
cd web
pnpm lint-fix                                   # must be 24/24
for p in @agenta/settings @agenta/navigation @agenta/oss @agenta/ee @agenta/mobile; do
  echo "== $p"
  pnpm --filter "$p" exec tsc --noEmit          # a failure here aborts the gate
done
echo "typecheck clean"
```

`tsc` runs directly, never as `$(… | grep -c 'error TS')`: inside a command substitution the
status is `grep`'s, so a `pnpm` that dies for any non-type reason prints `0` and the gate passes
on a broken build.

Then **actually look at it** — this is a layout change and static gates say nothing about it:

- `/m` settings with the flag unset, **at `lg`+** → sidebar is the settings nav, no top bar,
  matches OSS.
- `/m` settings with the flag unset, **on a phone** → the `lg:hidden` header is there, its button
  opens the drawer, and the drawer shows the *settings* nav. This is the case the takeover is
  most likely to break; check it first.
- `/m` settings with `NEXT_PUBLIC_SETTINGS_NESTED_NAV=true` → today's nested rail, both widths.
- OSS settings unchanged.

Arda runs the dev servers — ask for a URL rather than starting one.

## Context worth having

The target architecture is that **`web/mobile` replaces `web/oss` and `web/ee`**, with edition
as an env-var gate inside one app. That is why this flag is the right shape: `/m` has to be
able to present the same navigation OSS does, because it will *be* OSS. It is also why
anything still living in `oss/` or `ee/` counts as debt.

Commit messages: no "Claude"/"Anthropic"/"Co-Authored-By" lines.
