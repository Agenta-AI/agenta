Rules for every task: never edit or run `web/oss` or `web/ee` before PR 4 deletes them. Before removing any package symbol, `git grep` it in `web/oss` and `web/ee`. Run tests, type checks and lint locally only when the user asks; otherwise CI is the proof. Use GitButler (`but`) lanes as in design.md "PR stack". Each PR ships the proof listed under it.

## 1. PR 1 — Stop depending on web/oss from live code

Commit A: theme source.

- [ ] 1.1 Copy `palette.ts`, `controlScale.ts`, `legacy-shim.ts` from `web/oss/src/styles/theme/` to `web/packages/agenta-ui/src/styles/theme/`; add a subpath export in `agenta-ui/package.json`.
- [ ] 1.2 Repoint `web/scripts/generate-tailwind-tokens.ts`: import from the new path, delete the `createRequire(oss/package.json)` antd resolution and the `antd-overrides.generated.ts` output. If any CSS value still derives from antd, resolve `antd` from `@agenta/ui` and move `antd-themeConfig.json` with it.
- [ ] 1.3 Repoint `web/mobile/scripts/generate-shadcn-tokens.ts:18-19` to the new subpath.
- [ ] 1.4 Give `web/website` its own tailwind demo config (no `../oss/tailwind.config`); fix `web/packages/agenta-ui/components.json:7-8`.
- [ ] 1.5 Update the theme instructions: root `AGENTS.md` "Theme color changes", `web/AGENTS.md` theme lines and Styling section, `web/mobile/AGENTS.md:47`, `.agents/skills/agenta-package-practices/SKILL.md:17`, `.agents/skills/mobile-shadcn-conventions/SKILL.md:40-43`, generated CSS header comments. Drop the instruction to commit `antd-overrides.generated.ts`.
- [ ] 1.6 Proof: run `pnpm generate:tailwind-tokens`; `git diff --exit-code` on `theme-variables.css` and `theme.generated.css`; mobile `tokens:check`, website build, storybook build and entities unit tests in CI with `--frozen-lockfile`.

Commit B: dependencies hidden by oss hoisting.

- [ ] 1.7 Declare `antd` and `ai` in `web/storybook/package.json`, `@tanstack/query-core` in `web/packages/agenta-entities/package.json` (devDependency), at the versions the lockfile already resolves.
- [ ] 1.8 Proof: CI storybook build and entities unit tests green with `--frozen-lockfile`.

## 2. PR 2 — /m answers legacy desktop URLs and stops sending users to the desktop

Commit A: legacy URL handler.

- [ ] 2.1 In `mapDesktopToMobile`: keep `trace` on observability links; keep the full query on `/auth` links (invite, `auth_error`); add unit tests for the SDK trace link, the SDK evaluation link, the org settings link from `organization_service.py:609`, `/settings`, `/workspaces/accept`, `/post-signup`, `/:workspace_id/apps/:app_id`, and an unknown path.
- [ ] 2.2 In `web/mobile/next.config.ts` add `basePath: false` 307 redirects: `/` → `/m`; `/auth/callback/:rest*` → `/m/auth/callback/:rest*` (replace the rule at line 86); `/auth/reset-password` → `/m/auth/reset-password`; `/favicon.ico`, `/assets/:path*`, `/robots.txt` → `/m/...`; a final catch-all for root paths not starting with `m/`, `api/`, `services/`, `_next/` → `/m/legacy/:path*`.
- [ ] 2.3 Add `/legacy/:path*` to the `proxy.ts` matcher; answer it with `mapDesktopToMobile(path, search, {developerViews: true})` → 307; log the path (no query) when it falls back to the `/m` root.
- [ ] 2.4 Add `web/mobile/public/robots.txt`. Change `api/oss/src/apis/fastapi/tools/router.py:2223` to `/m/assets/favicon.ico`.
- [ ] 2.5 Proof: unit tests for 2.1 and the proxy branch; `curl -I` table against a direct-port `web/mobile` for every scenario in `specs/legacy-desktop-urls/spec.md`, pasted in the PR.

Commit B: stop sending users to the desktop (Developer Mode stays).

- [ ] 2.6 Remove the desktop bounce from `decideMobileGate`, remove `mobileGateScript` and its injection in `_document.tsx`, and remove `leaveForDesktop()` from `PreferencesTab` so the Developer Mode and beta switches only set their atoms. Keep both switches.
- [ ] 2.7 Keep `classicModeEnabledAtom`, `betaDeveloperModeFlagAtom` and `betaDeveloperModeActiveAtom` unchanged. Check that every consumer (`DeveloperViewGate`, `developerViewAccess.ts`, `developerPageFrame.ts`, `features/app-overview/*`, `features/annotations/*`, `ArchivedAppsScreen`, `BillingTab`) behaves as before.
- [ ] 2.8 Keep `useClassicModeCookieSync` and `useClassicModeRedirect` exported (`web/oss` imports them) until PR 4.
- [ ] 2.9 Proof: unit test that `decideMobileGate` never returns a desktop location with `agenta-classic-mode=1`; screenshots of `/m` Preferences, and of evaluations, annotations, testsets and prompts with Developer Mode on and off, before and after, light and dark.

## 3. PR 3 — Route / to web-mobile and retire the web service

- [ ] 3.1 Compose (oss and ee; dev, gh, gh.local, gh.ssl): delete `web` and `.web`; `web-mobile` takes the catch-all with lower priority than api and services; drop `depends_on: web`, the `with-web` profile, oss and ee volumes, `AGENTA_WEB_IMAGE_*` in env examples.
- [ ] 3.2 Add `web/mobile/docker/Dockerfile.dev`; point dev `web-mobile` at it.
- [ ] 3.3 nginx `location /` → web-mobile through a variable upstream (`set $mobile_upstream`).
- [ ] 3.4 `run.sh`: drop `WEB_MODE` web handling, `with-web`, the oss and ee chmod entries; local mode runs `web/mobile`. Delete `recreate-web.sh`. `test.sh`: drop the `web` component.
- [ ] 3.5 Helm: delete the `web` deployment, service and image helpers; `ingress.paths.web` routes to `web-mobile`; ignore a top-level `web` block; update `NOTES.txt`, value examples, and the helm tests (`test_web_mobile.py`, `test_availability.py`, `test_lifecycle_rollout.py`, `test_priority_and_spare_capacity.py`, `test_gateway_values.py`, `test_web_sandbox_providers.py`, `test_web_crisp.py`, `test_web_turnstile.py`); add a test with stale `web` values.
- [ ] 3.6 Railway: delete `hosting/railway/oss/web/`; remove `web` from `template.json`, `bootstrap.sh`, `configure.sh`, `deploy-from-images.sh`, `deploy-services.sh`, `lib.sh`, `smoke.sh`; gateway `/` → web-mobile; preview URL in `preview-clone-create.sh:651` and `test_preview_lifecycle.py` → `/m`; add the curl table to `smoke.sh`.
- [ ] 3.7 CI: `44-railway-tests.yml` delete the `auth_bootstrap` steps, `run-web-tests`, `web-only` and `all-but-web`, and fix the base URL `sed` at line 189; keep `agenta-web` in `42-railway-build.yml` until PR 4.
- [ ] 3.8 Upgrade note in `docs/docs/self-host/upgrade-and-migrate/01-upgrading.mdx`: update the compose file and the `agenta-web-mobile` tag together; how to roll back.
- [ ] 3.9 After merge: run Railway `apply.sh` on the template environment, recycle existing previews, flip the cloud ingress in `agenta_cloud` (only after the PR 2 image is live).
- [ ] 3.10 Proof: `run.sh --oss --gh`, `run.sh --ee --dev` and a backend-only nginx stack start; the curl table through Traefik and nginx; helm pytest; Railway preview smoke; `/m` sign-in screenshots (password and OAuth).

## 4. Soak

- [ ] 4.1 Watch the legacy fallback log on cloud for 7 days. Add a mapping for any path that has a `/m` page. Exit when 7 days pass with none.

## 5. PR 4 — Delete web/oss, web/ee and web/tests

Commit A: delete the folders and their tooling.

- [ ] 5.1 Confirm `agenta_cloud` no longer publishes `agenta-web` or `internal-ee-agenta-web`.
- [ ] 5.2 `git rm -r web/oss web/ee web/tests`.
- [ ] 5.3 `42-railway-build.yml`: remove the `agenta-web` matrix entry, manifest entry and comment. `01-create-release-branch.yml`: remove the oss and ee version bumps and PR body lines. `12-check-unit-tests.yml:77` comment.
- [ ] 5.4 `web/entrypoint.sh` writes `__env.js` only into `mobile/public`; remove `/app/{oss,ee}/public` from `web/mobile/docker/Dockerfile.gh:82-83`; update `api/oss/tests/pytest/unit/test_web_entrypoint_email_env.py`.
- [ ] 5.5 `web/package.json` (workspaces incl. `variants-state`, `link:` devDeps, oss/ee/test scripts, `format*` ignore paths, root `next`), `pnpm-workspace.yaml` (workspaces, overrides only oss needed), regenerate `pnpm-lock.yaml`, `turbo.json`, `web/eslint.config.mjs`, `web/mobile/eslint.config.mjs`, `web/.dockerignore`, root `.pre-commit-config.yaml`, root `.gitignore`.
- [ ] 5.6 `.claude/launch.json`, `examples/python/RAG_QA_chatbot/run-agent-chat-slice.sh`, `sdks/python/oss/tests/.../test_vercel_stream_conformance.py` (pin to `web/mobile/package.json`).
- [ ] 5.7 Proof: CI green (lint, types, unit, mobile, storybook and website builds); `pnpm install --frozen-lockfile` clean; grep for the guarded patterns returns only allowlisted files.

Commit B: desktop-only package code.

- [ ] 5.8 `mobileGate`: delete `decideDesktopGate`, `isDesktopOnlyLink`, the desktop cookies and their writers (`agenta-classic-mode`, `agenta-beta-developer-mode`, `agenta-mobile-optout`/`optin`), `useClassicModeRedirect`, `desktopEscapeHref`, `writeClassicModeCookie`, and `MOBILE_AUTH_CALLBACK_COOKIE` with its use in `agenta-auth/src/client.ts`. Rename `classicModeEnabledAtom` and related names to developer-mode names with no behavior change; the Developer Mode switch stays.
- [ ] 5.9 Delete `useFileActivityDetector` (`agenta-chat`), the `setup` option of `useCreateAgent` (`agenta-home-ui`), `readDesktopLastUsed` in `web/mobile/src/lib/context.ts`.
- [ ] 5.10 Delete oss-only subpaths after checking in-package use: `@agenta/annotation-ui` root, `context`, `queue-list`, `session`; `@agenta/playground-ui/{workflow-revision-drawer,execution-items,execution-item-comparison-view,mode-switch}`; `@agenta/entities/{runnable/deploy,shared/invalidation}`; `@agenta/ui/custom-resize-handle.css`; `@agenta/chat/tests/goldenSessions`.
- [ ] 5.11 Proof: CI green; `/m` smoke screenshots (home, agent chat, settings, sign-in).

## 6. PR 5 — Docs and guard

- [ ] 6.1 Rewrite agent instructions: root `AGENTS.md`, `web/AGENTS.md`, `web/mobile/AGENTS.md`, `.agents/skills/mobile-app-structure/SKILL.md:50`, `agent-release-gate/resources/test_qa_product_concurrency.py:429`.
- [ ] 6.2 Rewrite `web/packages/README.md`, `hosting/docker-compose/ee/README.md`, `hosting/railway/oss/README.md`, `hosting/railway/oss/template/README.md`, `docs/docs/self-host/99-faq.mdx`, `03-deploy-to-kubernetes.mdx`, `04-deploy-on-railway.mdx`, `01-upgrading.mdx`, `docs/design/testing/*.specs.md`, open `openspec/changes/*` that name web/oss files.
- [ ] 6.3 Rewrite or drop code comments in `web/packages/**`, `web/mobile/**`, `web/storybook/**`, `web/_reference/**`, `api/oss/src/core/sessions/streams/service.py:113`, `services/runner/src/engines/sandbox_agent/engine.ts:63`, `clients/scripts/generate.sh:528`, `17-check-mobile.yml:21-22`.
- [ ] 6.4 Add the note to `docs/design/README.md`. Add the CI grep guard with the allowlist in design.md D11; match `agenta-web` only when not followed by `-mobile`.
- [ ] 6.5 Proof: the guard passes; the guard fails on a seeded mention in a scratch commit.
