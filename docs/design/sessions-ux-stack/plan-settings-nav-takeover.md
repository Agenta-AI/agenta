# Plan: make `/m` settings navigation match OSS, and put the nested rail behind a flag

## Why

The nested settings side-panel on `/m` is contested inside the team. Rather than keep arguing
it or throw the work away, **make the OSS pattern the default and keep the nested one alive
behind an env var.** Nobody has to relitigate, and the code stays.

## The two patterns

**OSS — takeover (this becomes the default).** The main sidebar *is* the settings nav.
Its header turns into `← Back`, its sections become Project / Organization / Personal with an
icon per row, and the footer keeps Invite Teammate / Help & Docs / the project switcher. There
is **no in-page top bar** — the content pane starts directly with the tab title
("Members" / "Manage members, invitations, and access."). Second screenshot in the thread.

**`/m` — nested (this goes behind the flag).** The main rail (Home / Sessions / Agents) stays
put, a *second* rail appears next to it with the settings groups, and a "Settings" top bar sits
above the content. Three levels of chrome for one page. First screenshot.

## Requested outcome

1. Default `/m` behaviour == OSS takeover: settings replaces the main sidebar, top bar removed.
2. Nested rail stays reachable behind `NEXT_PUBLIC_SETTINGS_NESTED_NAV=true`.
3. OSS/EE unchanged — they already do the takeover.

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
  Both come out under the flag.
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

- `packages/agenta-settings/src/sidebar.ts` (new): the tab→icon map and a
  `buildSettingsSidebarSections(tabs, activeTab)` returning `SidebarSection[]`.
- `oss/.../settingsScope.tsx` keeps its hooks and calls the shared builder.
- `mobile/src/features/settings/settingsNavScope.tsx` (new): same builder, mobile's routing.

`SETTINGS_SCOPES` and `getSettingsSidebarTabs(access)` are already shared — the grouping and
labels must keep coming from there so the two rails cannot drift.

### 3. Takeover on `/m` (the default path)

When the flag is off:
- The sidebar renders the settings scope instead of `mobileNavScope` — header becomes
  `← Back` (returns to the last non-settings route), footer unchanged.
- `ScreenScaffold` drops the `<h1>Settings</h1>` row **from `lg` up**, where the rail is
  persistent and the page needs no second title.
- **Keep the `lg:hidden` header with its `NavDrawer` trigger.** Below `lg` the sidebar IS the
  drawer, so removing the trigger in takeover mode leaves a phone with no way to open the
  settings navigation at all — the takeover would hide the very thing it took over. The shipped
  `SettingsScreen.tsx` keeps this row for exactly that reason.
- The content pane renders `SettingsPageShell` alone, exactly as OSS does.
- So "takeover" means the *drawer's contents* change on a phone and the *rail's contents* change
  from `lg` up; the content pane is full-width either way. Check both breakpoints — `lg:` is
  where OSS's rail becomes persistent.

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

```bash
cd web
set -euo pipefail
pnpm lint-fix                                   # must be 24/24
for p in @agenta/settings @agenta/navigation @agenta/oss @agenta/ee @agenta/mobile; do
  # tsc's exit status IS the gate. `grep -c` inside a command substitution reports zero for any
  # failure that prints no `error TS` line and hands the pipeline `grep`'s status, so a compiler
  # that crashed or never ran reads as a pass.
  echo "== $p"
  pnpm --filter "$p" exec tsc --noEmit
done
```

Then **actually look at it** — this is a layout change and static gates say nothing about it:
- `/m` settings with the flag unset → sidebar is the settings nav, no top bar, matches OSS.
- `/m` settings with `NEXT_PUBLIC_SETTINGS_NESTED_NAV=true` → today's nested rail.
- Both at phone and `lg` widths.
- OSS settings unchanged.

Arda runs the dev servers — ask for a URL rather than starting one.

## Context worth having

The target architecture is that **`web/mobile` replaces `web/oss` and `web/ee`**, with edition
as an env-var gate inside one app. That is why this flag is the right shape: `/m` has to be
able to present the same navigation OSS does, because it will *be* OSS. It is also why
anything still living in `oss/` or `ee/` counts as debt.

Commit messages: no "Claude"/"Anthropic"/"Co-Authored-By" lines.
