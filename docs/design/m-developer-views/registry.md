# Developer views in /m: the staged switch

We rebuild the old app's developer pages (test sets, evaluations, prompts, and so on) in
`/m`, one view at a time. Each view merges hidden, then moves to preview, then to on. This
note is the contract every view PR follows.

## The registry

One file lists every view: `web/mobile/src/features/developer/developerViews.ts`.

```ts
export type DeveloperViewStage = "hidden" | "preview" | "on";
export type DeveloperNavSection = "developer";

export interface DeveloperView {
  id: string; // lowercase kebab-case, e.g. "testsets"
  label: string; // the rail link and the Preferences switch show it
  description: string; // one sentence under the Preferences switch
  routes?: readonly [string, ...string[]]; // project-relative Next patterns; routes[0] is the nav link
  nav?: { icon: Icon; section: DeveloperNavSection };
  stage: DeveloperViewStage;
}

export const DEVELOPER_VIEWS: readonly DeveloperView[] = [
  // A page with a rail link.
  {
    id: "testsets",
    label: "Test sets",
    description: "Show the Test sets page under Developer in the navigation.",
    routes: ["/testsets", "/testsets/[testset_id]"],
    nav: { icon: TableIcon, section: "developer" },
    stage: "hidden",
  },
  // A feature gate on a shared screen: no routes, no rail link.
  {
    id: "observability-app-filter",
    label: "Filter by app",
    description: "Show the app filter on traces and sessions.",
    stage: "hidden",
  },
];
```

A view with no `routes` is a feature gate on a shared screen (an action, a filter). The screen
calls `useDeveloperViewEnabled(id)` and shows the feature only on `true`. The call is cheap
(atoms and the list), so a shared screen may make it.

The registry imports no view code. A view's screen loads only from its own route page.

## Stages

| Stage     | Nav link                      | Route page                    | Preferences switch       |
| --------- | ----------------------------- | ----------------------------- | ------------------------ |
| `hidden`  | no                            | "not found"                   | no                       |
| `preview` | only if the user turned it on | only if the user turned it on | yes, under Feature Flags |
| `on`      | yes                           | yes                           | no                       |

A view without `routes` or `nav` has no rail link at any stage.

The preview switch is a per-user flag (`userScopedFlagAtom`), stored under
`agenta:settings:<user id>:developer-view:<view id>`.

## Names

- "Developer" is the nav section title on purpose. The Developer Mode switch in Preferences
  will show these /m views instead of sending people to the old app, so both words mean the
  same thing once the views ship.
- A "view" is a page, or a feature gate on a shared screen (a registry entry with no routes).
  It is not the list display state that types such as `AgentListView` name.

## Forced views (deployment override)

`AGENTA_DEVELOPER_VIEWS` on the web container is a comma-separated list of view ids. The
entrypoint writes it to `__env.js` as `NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS`, so a change needs a
restart, not a rebuild. A listed view is on for everyone on that deployment, whatever its stage.
Use it to turn a view on in staging before you change its stage.

## Beta developer mode (deployment switch)

`AGENTA_BETA_DEVELOPER_MODE` on the web container turns on the "Use new beta developer mode"
switch in Settings > Preferences, in /m and /w. The entrypoint writes it to `__env.js` as
`NEXT_PUBLIC_AGENTA_BETA_DEVELOPER_MODE`, so a change needs a restart, not a rebuild. Only
`true` turns it on. With any other value the switch is hidden, and every user's stored beta
switch (`agenta:settings:<user id>:beta-developer-mode`) reads as off: Developer Mode sends
the user to /w and the views follow their stage, as before beta developer mode existed.
`isBetaDeveloperModeEnabled()` in `@agenta/shared/api` reads it. The local dev env files set it
to `true`.

## One gate in beta developer mode

With beta developer mode active, every view in the registry is on: pages, nav links, feature
gates and every cross link (Overview, Open in playground, the prompt row click). Nothing on
the developer side checks `stage` for that user, and Preferences shows no preview switches
(they would change nothing). A view added to the registry needs no extra step to appear.

Stages, the preview switches and `AGENTA_DEVELOPER_VIEWS` stay for users without beta
developer mode (and for deployments that do not offer it, such as production). They are the
only place `stage` is read. Do not read `stage` in a screen or a cross link: ask
`useDeveloperViewEnabled(id)`.

## Helpers (`features/developer/developerViewAccess.ts`)

- `isDeveloperViewEnabled(view, {previewOptedIn, forcedIds})`: the pure rule.
- `useDeveloperViewEnabled(viewId)`: `true`, `false`, or `null` until the signed-in user is
  Under beta developer mode it is `true` for every view in the registry.
  known. The first render is always `null`, so the answer never differs from the prerendered
  HTML.
- `useEnabledDeveloperViews()`: the views the nav shows.
- `developerViewPreviewSwitchesAtom`: the Preferences switches and their setter.
- `DeveloperViewGate` (`features/developer/DeveloperViewGate.tsx`): wraps a view's page. It
  renders the view, the app's "not found" page, or nothing while the user is unknown.

## How a view PR uses it

1. Add the entry with `stage: "hidden"`.
2. Add the route page under `src/pages/w/[workspace_id]/p/[project_id]/`. Wrap the screen in
   `<DeveloperViewGate viewId="...">`. Do not import the view anywhere else.
3. The nav section and the Preferences switch need no change. Nav links use
   `prefetch={false}`. This stops prefetch when the link scrolls into view; Next still
   prefetches when the user hovers the link, which is a user choice to open that view.
4. To move to preview or on, change `stage` in a separate small PR.

## Sending /w pages to /m when a view is on

The old app sends a page to `/m` through `mobileRouteFor` in
`web/packages/agenta-shared/src/utils/mobileGate/index.ts`. The `/w` middleware and
`useClassicModeRedirect` both call it, so one function covers both. A path it maps goes to
`/m` for a user with Classic mode off. A path it returns `null` for stays on `/w`.

The registry cannot drive this. It lives in `/m`, and the `/w` middleware cannot read it or the
`/m` runtime env. So the PR that moves a view to `on` also adds its paths to `mobileRouteFor`
(and the inverse to `desktopRouteFor`, so the Classic mode switch lands on the same page), with
a test in `web/packages/agenta-shared`. That is a few lines in the shared package and no `/w`
file. A view in `preview`, or one forced on by the env, does not redirect from `/w`.

This PR does not change `mobileRouteFor`, because no view is on yet.
