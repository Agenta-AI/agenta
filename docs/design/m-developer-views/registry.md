# Developer views in /m

We rebuild the old app's developer pages (test sets, evaluations, prompts, and so on) in
`/m`, one view at a time. Developer Mode in `/m` shows every view. A deployment can also force a
view on for everyone. There is no per-user switch for a single view. This note is the contract
every view PR follows.

## The registry

One file lists every view: `web/mobile/src/features/developer/developerViews.ts`.

```ts
export type DeveloperNavSection = "developer";

export interface DeveloperView {
  id: string; // lowercase kebab-case, e.g. "testsets"
  label: string; // the rail link shows it
  routes?: readonly [string, ...string[]]; // project-relative Next patterns; routes[0] is the nav link
  nav?: { icon: Icon; section: DeveloperNavSection };
}

export const DEVELOPER_VIEWS: readonly DeveloperView[] = [
  // A page with a rail link.
  {
    id: "testsets",
    label: "Test sets",
    routes: ["/testsets", "/testsets/[testset_id]"],
    nav: { icon: TableIcon, section: "developer" },
  },
  // A feature gate on a shared screen: no routes, no rail link.
  {
    id: "observability-app-filter",
    label: "Filter by app",
  },
];
```

A view with no `routes` is a feature gate on a shared screen (an action, a filter). The screen
calls `useDeveloperViewEnabled(id)` and shows the feature only on `true`. The call is cheap
(atoms and the list), so a shared screen may make it.

The registry imports no view code. A view's screen loads only from its own route page.

## Who sees a view

| User                                        | Nav link | Route page  |
| ------------------------------------------- | -------- | ----------- |
| Developer Mode on, classic app off          | yes      | yes         |
| Otherwise, view in `AGENTA_DEVELOPER_VIEWS` | yes      | yes         |
| Otherwise, view not forced                  | no       | "not found" |

A view without `routes` or `nav` has no rail link.

A route page that passes `betaOnly` to `DeveloperViewGate` is the exception. It shows "not found"
when Developer Mode does not open in `/m`, even if the view is forced on. The app pages for variants,
endpoints, evaluations and traces use `betaOnly` today.

## Names

- "Developer" is the nav section title on purpose. The Developer Mode switch in Preferences
  will show these /m views instead of sending people to the old app, so both words mean the
  same thing once the views ship.
- A "view" is a page, or a feature gate on a shared screen (a registry entry with no routes).
  It is not the list display state that types such as `AgentListView` name.

## Forced views (deployment override)

`AGENTA_DEVELOPER_VIEWS` on the web container is a comma-separated list of view ids. The
entrypoint writes it to `__env.js` as `NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS`, so a change needs a
restart, not a rebuild. A listed view is on for everyone on that deployment, except on route
pages that pass `betaOnly`, which still need Developer Mode in `/m`.

## Developer Mode opens in `/m` (the "Use classic app" switch)

Developer Mode opens the Developer section in `/m` by default, for every user. The "Use classic
app (will be deprecated)" switch in Settings > Preferences shows under Developer Mode. Only a
user who turns it on is sent to `/w` (stored as `agenta:settings:<user id>:classic-app`). Code
reads `betaDeveloperModeActiveAtom` in `@agenta/shared/state`: Developer Mode on and the classic
app off. The old "Use new beta developer mode" switch, its stored value and the
`AGENTA_BETA_DEVELOPER_MODE` env var are no longer read.

## One gate in Developer Mode

With Developer Mode in `/m`, every view in the registry is on: pages, nav links, feature
gates and every cross link (Overview, Open in playground, the prompt row click). A view added
to the registry needs no extra step to appear. Do not check the switches in a screen or a
cross link: ask `useDeveloperViewEnabled(id)`.

## Helpers (`features/developer/developerViewAccess.ts`)

- `useDeveloperViewEnabled(viewId)`: `true`, `false`, or `null` until the signed-in user is
  known. With Developer Mode in `/m` it is `true` for every view in the registry. The first
  render is always `null`, so the answer never differs from the prerendered HTML.
- `useEnabledDeveloperViews()`: the views the nav shows.
- `DeveloperViewGate` (`features/developer/DeveloperViewGate.tsx`): wraps a view's page. It
  renders the view, the app's "not found" page, or nothing while the user is unknown.

## How a view PR uses it

1. Add the entry to the registry.
2. Add the route page under `src/pages/w/[workspace_id]/p/[project_id]/`. Wrap the screen in
   `<DeveloperViewGate viewId="...">`. Do not import the view anywhere else.
3. The nav section needs no change. Nav links use
   `prefetch={false}`. This stops prefetch when the link scrolls into view; Next still
   prefetches when the user hovers the link, which is a user choice to open that view.

## Sending /w pages to /m

The old app sends a page to `/m` through `mobileRouteFor` in
`web/packages/agenta-shared/src/utils/mobileGate/index.ts`. The `/w` middleware and
`useClassicModeRedirect` both call it, so one function covers both. A path it maps goes to
`/m` for a user with Classic mode off. A path it returns `null` for stays on `/w`.

The registry cannot drive this. It lives in `/m`, and the `/w` middleware cannot read it or the
`/m` runtime env. So a PR that makes a view available to every user also adds its paths to `mobileRouteFor`
(and the inverse to `desktopRouteFor`, so the Classic mode switch lands on the same page), with
a test in `web/packages/agenta-shared`. That is a few lines in the shared package and no `/w`
file. A view forced on by the env does not redirect from `/w`.
