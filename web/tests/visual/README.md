# Visual capture specs

Two Playwright specs that save PNG files of app states. They compare nothing, store no
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
