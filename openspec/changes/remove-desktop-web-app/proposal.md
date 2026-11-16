## Why

`web/oss` and `web/ee` are the abandoned desktop app. `/m` (`web/mobile`) is the only app we build features in. The desktop app still costs us:

- It owns `/`. Every deployment runs a second frontend container (`web`, image `agenta-web` / `internal-ee-agenta-web`) whose job today is mostly to redirect into `/m`.
- It holds live pieces: the theme source of truth (`web/oss/src/styles/theme/`), the dev image for `web-mobile`, the Playwright harness, and the `__env.js` license folder in `web/entrypoint.sh`.
- CI, compose, helm, Railway, the release workflow and about 42 npm dependencies exist only for it.
- Agent instructions, docs and code comments keep pointing at it, so people and agents still read it.

## What Changes

- The theme source moves into `@agenta/ui`. Generated CSS stays byte-identical.
- `/m` answers every legacy desktop URL: `/`, `/w/*`, `/apps/*`, `/auth*`, `/post-signup`, `/workspaces/*`, `/settings`, any other root path, `/favicon.ico`, `/assets/*`, `/robots.txt`. One function, `mapDesktopToMobile`, owns the mapping.
- `/m` stops sending users to the desktop. The Developer Mode switch stays and keeps gating the evaluations, annotations, testsets and prompts views.
- `web-mobile` takes the catch-all route in compose, nginx, helm, Railway and cloud. The `web` service leaves every deployment.
- After a soak with an exit criterion, `web/oss`, `web/ee` and `web/tests` are deleted with all their tooling, CI steps, images and dependencies.
- Package code that only the desktop used is deleted, including `@agenta/annotation-ui` and the antd components in `@agenta/playground-ui`. `antd` and `@ant-design/*` leave every package.
- Agent instructions, docs and comments stop naming the deleted paths. A CI grep guard keeps it that way.
- **BREAKING (self-hosted)**: compose files and the helm chart no longer have a `web` service. Users update the compose file and the `agenta-web-mobile` tag together.

Not changed: the OAuth redirect URI registered at providers (`/auth/callback/<id>`), the SDK and backend link formats (`/w/...` stays valid forever through the legacy handler), SuperTokens `website_base_path`.

## Capabilities

### New Capabilities

- `legacy-desktop-urls`: how `/m` answers URLs that the desktop app used to serve.
- `single-frontend-service`: `web-mobile` is the only frontend service in every deployment target.

### Modified Capabilities

None.

## Impact

- `web/oss`, `web/ee`, `web/tests` (deleted).
- `web/packages/agenta-ui` (theme source), `web/packages/agenta-shared` (mobileGate, classic mode), `web/packages/agenta-auth`, `agenta-chat`, `agenta-home-ui`, `agenta-annotation-ui`, `agenta-playground-ui`, `agenta-entities` (dead exports).
- `web/mobile` (`next.config.ts`, `proxy.ts`, Preferences, Billing, new `docker/Dockerfile.dev`, `public/robots.txt`).
- `web/website`, `web/storybook` (config and declared deps).
- `web/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, eslint configs, `.dockerignore`, `entrypoint.sh`, `scripts/generate-tailwind-tokens.ts`.
- `hosting/docker-compose/**`, `hosting/kubernetes/**`, `hosting/railway/oss/**`.
- `.github/workflows/01,12,42,44`; external `agenta_cloud` release and ingress.
- `api/oss/src/apis/fastapi/tools/router.py` (favicon URL), `api/oss/tests/pytest/unit/test_web_entrypoint_email_env.py`, `sdks/python/oss/tests/.../test_vercel_stream_conformance.py`.
- `AGENTS.md` (root, `web/`, `web/mobile/`), `.agents/skills/*`, `docs/docs/self-host/**`, `docs/design/testing/*.specs.md`, `web/packages/README.md`, hosting READMEs, open `openspec/changes/*`.
