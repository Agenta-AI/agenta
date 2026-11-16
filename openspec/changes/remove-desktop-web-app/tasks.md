Rules for every task: never edit or run `web/oss` or `web/ee` before PR 6 deletes them. Before removing any package symbol, `git grep` it in `web/oss` and `web/ee`. Run tests, type checks and lint locally only when the user asks; otherwise CI is the proof. Use GitButler (`but`) lanes as in design.md "PR stack". Each PR ships the proof listed under it.

## 1. PR 1 — Theme source of truth into @agenta/ui

- [ ] 1.1 Copy `palette.ts`, `controlScale.ts`, `legacy-shim.ts` from `web/oss/src/styles/theme/` to `web/packages/agenta-ui/src/styles/theme/`; add a subpath export in `agenta-ui/package.json`.
- [ ] 1.2 Repoint `web/scripts/generate-tailwind-tokens.ts`: import from the new path, delete the `createRequire(oss/package.json)` antd resolution and the `antd-overrides.generated.ts` output. If any CSS value still derives from antd, resolve `antd` from `@agenta/ui` and move `antd-themeConfig.json` with it.
- [ ] 1.3 Repoint `web/mobile/scripts/generate-shadcn-tokens.ts:18-19` to the new subpath.
- [ ] 1.4 Give `web/website` its own tailwind demo config (no `../oss/tailwind.config`); fix `web/packages/agenta-ui/components.json:7-8`.
- [ ] 1.5 Update the theme instructions: root `AGENTS.md` "Theme color changes", `web/AGENTS.md` theme lines and Styling section, `web/mobile/AGENTS.md:47`, `.agents/skills/agenta-package-practices/SKILL.md:17`, `.agents/skills/mobile-shadcn-conventions/SKILL.md:40-43`, generated CSS header comments. Drop the instruction to commit `antd-overrides.generated.ts`.
- [ ] 1.6 Proof: run `pnpm generate:tailwind-tokens`; `git diff --exit-code` on `theme-variables.css` and `theme.generated.css`; mobile `tokens:check` and website build in CI.

## 2. PR 2 — Declare dependencies hidden by oss hoisting

- [ ] 2.1 Declare `antd` and `ai` in `web/storybook/package.json`, `@tanstack/query-core` in `web/packages/agenta-entities/package.json` (devDependency), at the versions the lockfile already resolves.
- [ ] 2.2 Proof: CI storybook build and entities unit tests green with `--frozen-lockfile`.

## 3. PR 3 — /m answers legacy desktop URLs

- [ ] 3.1 In `mapDesktopToMobile`: keep `trace` on observability links; keep the full query on `/auth` links (invite, `auth_error`); add unit tests for the SDK trace link, the SDK evaluation link, the org settings link from `organization_service.py:609`, `/settings`, `/workspaces/accept`, `/post-signup`, `/:workspace_id/apps/:app_id`, and an unknown path.
- [ ] 3.2 In `web/mobile/next.config.ts` add `basePath: false` 307 redirects: `/` → `/m`; `/auth/callback/:rest*` → `/m/auth/callback/:rest*` (replace the rule at line 86); `/auth/reset-password` → `/m/auth/reset-password`; `/favicon.ico`, `/assets/:path*`, `/robots.txt` → `/m/...`; a final catch-all for root paths not starting with `m/`, `api/`, `services/`, `_next/` → `/m/legacy/:path*`.
- [ ] 3.3 Add `/legacy/:path*` to the `proxy.ts` matcher; answer it with `mapDesktopToMobile(path, search, {developerViews: true})` → 307; log the path (no query) when it falls back to the `/m` root.
- [ ] 3.4 Add `web/mobile/public/robots.txt`. Change `api/oss/src/apis/fastapi/tools/router.py:2223` to `/m/assets/favicon.ico`.
- [ ] 3.5 Proof: unit tests for 3.1 and the proxy branch; `curl -I` table against a direct-port `web/mobile` for every scenario in `specs/legacy-desktop-urls/spec.md`, pasted in the PR.

## 4. PR 4 — Remove Classic mode from /m

- [ ] 4.1 Remove the desktop bounce from `decideMobileGate`, remove `mobileGateScript` and its injection in `_document.tsx`, and remove the Classic mode switch from `PreferencesTab` and `PreferencesPage`.
- [ ] 4.2 Keep `BillingTab` `developerMode` on `betaDeveloperModeFlagAtom`; check every `classicModeEnabledAtom` and `betaDeveloperModeFlagAtom` consumer in `web/mobile` and `web/packages`.
- [ ] 4.3 Keep `useClassicModeCookieSync` and `useClassicModeRedirect` exported (`web/oss` imports them) until PR 7.
- [ ] 4.4 Proof: unit test that `decideMobileGate` never returns a desktop location with `agenta-classic-mode=1`; before/after screenshots of `/m` Preferences and Billing, light and dark.

## 5. PR 5 — Route / to web-mobile and retire the web service

- [ ] 5.1 Compose (oss and ee; dev, gh, gh.local, gh.ssl): delete `web` and `.web`; `web-mobile` takes the catch-all with lower priority than api and services; drop `depends_on: web`, the `with-web` profile, oss and ee volumes, `AGENTA_WEB_IMAGE_*` in env examples.
- [ ] 5.2 Add `web/mobile/docker/Dockerfile.dev`; point dev `web-mobile` at it.
- [ ] 5.3 nginx `location /` → web-mobile through a variable upstream (`set $mobile_upstream`).
- [ ] 5.4 `run.sh`: drop `WEB_MODE` web handling, `with-web`, the oss and ee chmod entries; local mode runs `web/mobile`. Delete `recreate-web.sh`. `test.sh`: drop the `web` component.
- [ ] 5.5 Helm: delete the `web` deployment, service and image helpers; `ingress.paths.web` routes to `web-mobile`; ignore a top-level `web` block; update `NOTES.txt`, value examples, and the helm tests (`test_web_mobile.py`, `test_availability.py`, `test_lifecycle_rollout.py`, `test_priority_and_spare_capacity.py`, `test_gateway_values.py`, `test_web_sandbox_providers.py`, `test_web_crisp.py`, `test_web_turnstile.py`); add a test with stale `web` values.
- [ ] 5.6 Railway: delete `hosting/railway/oss/web/`; remove `web` from `template.json`, `bootstrap.sh`, `configure.sh`, `deploy-from-images.sh`, `deploy-services.sh`, `lib.sh`, `smoke.sh`; gateway `/` → web-mobile; preview URL in `preview-clone-create.sh:651` and `test_preview_lifecycle.py` → `/m`; add the curl table to `smoke.sh`.
- [ ] 5.7 CI: `44-railway-tests.yml` delete the `auth_bootstrap` steps, `run-web-tests`, `web-only` and `all-but-web`, and fix the base URL `sed` at line 189; keep `agenta-web` in `42-railway-build.yml` until PR 6.
- [ ] 5.8 Upgrade note in `docs/docs/self-host/upgrade-and-migrate/01-upgrading.mdx`: update the compose file and the `agenta-web-mobile` tag together; how to roll back.
- [ ] 5.9 After merge: run Railway `apply.sh` on the template environment, recycle existing previews, flip the cloud ingress in `agenta_cloud` (only after the PR 3 + PR 4 image is live).
- [ ] 5.10 Proof: `run.sh --oss --gh`, `run.sh --ee --dev` and a backend-only nginx stack start; the curl table through Traefik and nginx; helm pytest; Railway preview smoke; `/m` sign-in screenshots (password and OAuth).

## 6. Soak

- [ ] 6.1 Watch the legacy fallback log on cloud for 7 days. Add a mapping for any path that has a `/m` page. Exit when 7 days pass with none.

## 7. PR 6 — Delete web/oss, web/ee and web/tests

- [ ] 7.1 Confirm `agenta_cloud` no longer publishes `agenta-web` or `internal-ee-agenta-web`.
- [ ] 7.2 `git rm -r web/oss web/ee web/tests`.
- [ ] 7.3 `42-railway-build.yml`: remove the `agenta-web` matrix entry, manifest entry and comment. `01-create-release-branch.yml`: remove the oss and ee version bumps and PR body lines. `12-check-unit-tests.yml:77` comment.
- [ ] 7.4 `web/entrypoint.sh` writes `__env.js` only into `mobile/public`; remove `/app/{oss,ee}/public` from `web/mobile/docker/Dockerfile.gh:82-83`; update `api/oss/tests/pytest/unit/test_web_entrypoint_email_env.py`.
- [ ] 7.5 `web/package.json` (workspaces incl. `variants-state`, `link:` devDeps, oss/ee/test scripts, `format*` ignore paths, root `next`), `pnpm-workspace.yaml` (workspaces, overrides only oss needed), regenerate `pnpm-lock.yaml`, `turbo.json`, `web/eslint.config.mjs`, `web/mobile/eslint.config.mjs`, `web/.dockerignore`, root `.pre-commit-config.yaml`, root `.gitignore`.
- [ ] 7.6 `.claude/launch.json`, `examples/python/RAG_QA_chatbot/run-agent-chat-slice.sh`, `sdks/python/oss/tests/.../test_vercel_stream_conformance.py` (pin to `web/mobile/package.json`).
- [ ] 7.7 Proof: CI green (lint, types, unit, mobile, storybook and website builds); `pnpm install --frozen-lockfile` clean; grep for the guarded patterns returns only allowlisted files.

## 8. PR 7 — Remove desktop-only package code

- [ ] 8.1 `mobileGate`: delete `decideDesktopGate`, `isDesktopOnlyLink`, desktop cookies, and `MOBILE_AUTH_CALLBACK_COOKIE` with its use in `agenta-auth/src/client.ts`; delete `useClassicModeGate.ts` and the classic-mode atoms with no consumer left.
- [ ] 8.2 Delete `useFileActivityDetector` (`agenta-chat`), the `setup` option of `useCreateAgent` (`agenta-home-ui`), `readDesktopLastUsed` in `web/mobile/src/lib/context.ts`.
- [ ] 8.3 Delete oss-only subpaths after checking in-package use: `@agenta/annotation-ui` root, `context`, `queue-list`, `session`; `@agenta/playground-ui/{workflow-revision-drawer,execution-items,execution-item-comparison-view,mode-switch}`; `@agenta/entities/{runnable/deploy,shared/invalidation}`; `@agenta/ui/custom-resize-handle.css`; `@agenta/chat/tests/goldenSessions`.
- [ ] 8.4 Proof: CI green; `/m` smoke screenshots (home, agent chat, settings, sign-in).

## 9. PR 8 — Docs and guard

- [ ] 9.1 Rewrite agent instructions: root `AGENTS.md`, `web/AGENTS.md`, `web/mobile/AGENTS.md`, `.agents/skills/mobile-app-structure/SKILL.md:50`, `agent-release-gate/resources/test_qa_product_concurrency.py:429`.
- [ ] 9.2 Rewrite `web/packages/README.md`, `hosting/docker-compose/ee/README.md`, `hosting/railway/oss/README.md`, `hosting/railway/oss/template/README.md`, `docs/docs/self-host/99-faq.mdx`, `03-deploy-to-kubernetes.mdx`, `04-deploy-on-railway.mdx`, `01-upgrading.mdx`, `docs/design/testing/*.specs.md`, open `openspec/changes/*` that name web/oss files.
- [ ] 9.3 Rewrite or drop code comments in `web/packages/**`, `web/mobile/**`, `web/storybook/**`, `web/_reference/**`, `api/oss/src/core/sessions/streams/service.py:113`, `services/runner/src/engines/sandbox_agent/engine.ts:63`, `clients/scripts/generate.sh:528`, `17-check-mobile.yml:21-22`.
- [ ] 9.4 Add the note to `docs/design/README.md`. Add the CI grep guard with the allowlist in design.md D11; match `agenta-web` only when not followed by `-mobile`.
- [ ] 9.5 Proof: the guard passes; the guard fails on a seeded mention in a scratch commit.
