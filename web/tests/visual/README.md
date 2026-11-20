# Visual capture specs

Two Playwright specs that save PNG files of app states, and one timing spec (below). They compare nothing, store no
baseline image and never run in CI. They use the `@playwright/test` of `web/tests`.

A recipe file (`recipes/<slug>.json`) is one JSON array.

- A story recipe: `{id, story, width, height, theme, selector?}`. `story` is the Storybook story id.
- A screen recipe: `{id, route, width, height, theme, steps, selector?}`. A `{name}` in `route` is replaced by the id of that name in the file `IDS`. A step is one of `{click: target}`, `{fill: target, value}`, `{press: key}`, `{wait: target | milliseconds}`. A target is a visible text, or `role:name` (for example `button:Save`).

Run from `web/`. Start Storybook first (`NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @agenta/storybook storybook --ci`).

```bash
STORYBOOK_URL=http://localhost:6006 RECIPES=visual/recipes/_sample.json OUT=<dir> pnpm --filter agenta-web-tests exec playwright test -c visual/playwright.visual.config.ts stories.spec.ts
APP_URL=<stack url> QA_EMAIL=... QA_PASSWORD=... RECIPES=... OUT=<dir> pnpm --filter agenta-web-tests exec playwright test -c visual/playwright.visual.config.ts screens.spec.ts
```

`screens.spec.ts` signs in once with `QA_EMAIL` and `QA_PASSWORD` and keeps the state in `OUT/.auth.json`.
Set `IDS` to the seed id file when a route has `{name}` placeholders.

## Session switch timing

`switch.spec.ts` measures a sidebar session switch in a production build (warm and cold, click to
URL, click to done in the page conversation, long tasks, every API request). It runs only on
demand, alone on its machine, and is skipped when `SWITCH_CASES` is not set. `SWITCH_CASES` is a
JSON file `{"origin", "sameAgent", "otherAgent"}`, each `{"id": "<session id>", "marker": "<text of
its last turn>"}`. Optional: `RUNS` (default 5), `CPU_THROTTLE`, `PANEL=builder`.

```bash
APP_URL=<production build url> QA_EMAIL=... QA_PASSWORD=... SWITCH_CASES=<cases.json> OUT=<dir> pnpm --filter agenta-web-tests exec playwright test -c visual/playwright.visual.config.ts switch.spec.ts
```
