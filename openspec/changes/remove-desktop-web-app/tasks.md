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

Commit B: stop sending users to the desktop; Developer Mode becomes one switch.

- [ ] 2.6 Remove the desktop bounce from `decideMobileGate`, remove `mobileGateScript` and its injection in `_document.tsx`, and remove `leaveForDesktop()` from `PreferencesTab`.
- [ ] 2.7 Make Developer Mode one switch: `betaDeveloperModeActiveAtom` depends on Developer Mode only; remove the beta developer mode switch from `PreferencesTab` and `PreferencesPage`. Every consumer (`DeveloperViewGate`, `developerViewAccess.ts`, `developerPageFrame.ts`, `features/app-overview/*`, `features/annotations/*`, `ArchivedAppsScreen`, `BillingTab`) keeps reading `betaDeveloperModeActiveAtom`. Unit test: Developer Mode on shows the developer views with no beta flag.
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

- [ ] 4.1 Wait one release after the release that carries PR 3. Watch the legacy fallback log on cloud and add a mapping for any path that has a `/m` page before PR 4.

## 5. PR 4 — Delete web/oss and web/ee, disable web/tests, and remove every mention

Commit A: delete the folders and their tooling.

- [ ] 5.1 Confirm `agenta_cloud` no longer publishes `agenta-web` or `internal-ee-agenta-web`.
- [ ] 5.2 `git rm -r web/oss web/ee` (this removes the desktop Playwright specs too).
- [ ] 5.3 Decouple `web/tests`: copy the types from `web/oss/src/lib/Types` and `usePreviewEvaluations/types` that its fixtures use; point `testDir` in `playwright/config/runtime.ts` and `scripts/run-tests.ts` at an empty `web/tests/specs`; drop the `AGENTA_LICENSE` switch; update `web/tests/README.md` and `guides/*` to say the harness is disabled and `global-setup.ts` needs a `/m` sign-in before the first spec.
- [ ] 5.4 `42-railway-build.yml`: remove the `agenta-web` matrix entry, manifest entry and comment. `01-create-release-branch.yml`: remove the oss and ee version bumps and PR body lines. `12-check-unit-tests.yml:77` comment.
- [ ] 5.5 `web/entrypoint.sh` writes `__env.js` only into `mobile/public`; remove `/app/{oss,ee}/public` from `web/mobile/docker/Dockerfile.gh:82-83`; update `api/oss/tests/pytest/unit/test_web_entrypoint_email_env.py`.
- [ ] 5.6 `web/package.json` (workspaces incl. `variants-state`, `link:` devDeps, oss/ee scripts and the `test:*` datalayer scripts, `format*` ignore paths, root `next`), `pnpm-workspace.yaml` (workspaces, overrides only oss needed), regenerate `pnpm-lock.yaml`, `turbo.json`, `web/eslint.config.mjs`, `web/mobile/eslint.config.mjs`, `web/.dockerignore`, root `.pre-commit-config.yaml`, root `.gitignore`.
- [ ] 5.7 `.claude/launch.json`, `examples/python/RAG_QA_chatbot/run-agent-chat-slice.sh`, `sdks/python/oss/tests/.../test_vercel_stream_conformance.py` (pin to `web/mobile/package.json`).
- [ ] 5.8 Proof: CI green (lint, types, unit, mobile, storybook and website builds); `pnpm install --frozen-lockfile` clean.

Commit B: docs, instructions and the guard.

- [ ] 5.9 Rewrite agent instructions: root `AGENTS.md`, `web/AGENTS.md`, `web/mobile/AGENTS.md`, `.agents/skills/mobile-app-structure/SKILL.md:50`, `agent-release-gate/resources/test_qa_product_concurrency.py:429`.
- [ ] 5.10 Rewrite `web/packages/README.md`, `hosting/docker-compose/ee/README.md`, `hosting/railway/oss/README.md`, `hosting/railway/oss/template/README.md`, `docs/docs/self-host/99-faq.mdx`, `03-deploy-to-kubernetes.mdx`, `04-deploy-on-railway.mdx`, `01-upgrading.mdx`, `docs/design/testing/*.specs.md`, open `openspec/changes/*` that name web/oss files.
- [ ] 5.11 Rewrite or drop comments outside `web/packages`: `web/mobile/**`, `web/storybook/**`, `web/_reference/**`, `api/oss/src/core/sessions/streams/service.py:113`, `services/runner/src/engines/sandbox_agent/engine.ts:63`, `clients/scripts/generate.sh:528`, `17-check-mobile.yml:21-22`. Package comments change in PR 5 with the code they describe.
- [ ] 5.12 Add the note to `docs/design/README.md`. Add the CI grep guard with the allowlist in design.md D11; match `agenta-web` only when not followed by `-mobile`. Allowlist `web/packages/**` until PR 5 lands, then remove it from the allowlist.
- [ ] 5.13 Proof: the guard passes; the guard fails on a seeded mention in a scratch commit.

## 6. PR 5 — Remove package code that only the desktop used, and antd

Baseline (2026-11-16, static import trace from `web/mobile/src`, `web/mobile/scripts` and `web/website/src` through every `@agenta/*` export map; type-only imports ignored): about 190 package source files are not reached. Of these, `@agenta/annotation-ui` (30 of 30 files, 19 import antd) and `@agenta/playground-ui` (68 of 190, 28 import antd) are the bulk. The rest are 1 to 26 files each in `entities`, `entity-ui`, `settings-ui`, `ui`, `shared`, `observability*`, `annotation`. No antd module is reached at runtime from `/m`. Recompute this list at the start of the PR: `web/oss` was still a consumer when it was taken.

Commit A: desktop gate and desktop-only symbols.

- [ ] 6.1 `mobileGate`: delete `decideDesktopGate`, `isDesktopOnlyLink`, the desktop cookies and their writers (`agenta-classic-mode`, `agenta-beta-developer-mode`, `agenta-mobile-optout`/`optin`), `useClassicModeRedirect`, `desktopEscapeHref`, `writeClassicModeCookie`, and `MOBILE_AUTH_CALLBACK_COOKIE` with its use in `agenta-auth/src/client.ts`. Rename `classicModeEnabledAtom` and related names to developer-mode names with no behavior change; the Developer Mode switch stays.
- [ ] 6.2 Delete `useFileActivityDetector` (`agenta-chat`), the `setup` option of `useCreateAgent` (`agenta-home-ui`), `readDesktopLastUsed` in `web/mobile/src/lib/context.ts`.

Commit B: unused files and exports.

- [ ] 6.3 Run an unused-code report (`knip` in the `web` workspace, entries: `web/mobile` pages, `web/mobile/scripts`, `web/website`, `web/storybook` stories, package unit tests). Save the report in the PR.
- [ ] 6.4 Delete the whole `@agenta/annotation-ui` package. Replace the default add-to-queue slot in `agenta-observability-ui/src/traceDrawer/referenceSlots.tsx` with an empty default (`/m` already registers its own picker), then remove the `@agenta/annotation-ui/add-to-queue` alias from `web/mobile/next.config.ts` and the package ban from `web/mobile/eslint.config.mjs`.
- [ ] 6.5 Delete the unused `@agenta/playground-ui` components (`ExecutionItems`, `ExecutionItemComparisonView`, `ExecutionHeader`, `ExecutionResultView`, `EntitySelector`, `TestsetSelectionModal`, `PlaygroundInputsBody`, `PlaygroundOutputs`, `TurnMessageHeaderOptions`, `EmptyState`, `shared/EvaluatorFieldGrid`, `shared/NodeResultCard`, `adapters/*`, `workflow-revision-drawer`, `mode-switch`, and the rest the report lists), their subpath exports, and their entries in the root barrel.
- [ ] 6.6 Delete the other unused files and exports the report lists, including the subpaths `@agenta/entities/{runnable/deploy,shared/invalidation}`, `@agenta/ui/custom-resize-handle.css`, `@agenta/chat/tests/goldenSessions`. Delete unit tests that only cover deleted code.
- [ ] 6.7 Storybook: delete stories whose component is deleted; switch stories that import the `@agenta/playground-ui` root barrel to subpaths.
- [ ] 6.8 Rewrite or drop the package comments that name the desktop app (`agenta-observability-ui`, `agenta-entities`, `agenta-chat`, `agenta-ui`, `agenta-playground-ui`, `agenta-entity-ui`, `agenta-shared`, `agenta-settings-ui`, `agenta-auth`). Remove `web/packages/**` from the guard allowlist.

Commit C: antd out of the packages.

- [ ] 6.9 Replace the antd type imports in `agenta-ui/src/InfiniteVirtualTable/{antdColumns.ts,types.ts,components/InfiniteVirtualTableInner.tsx,hooks/useExpandableRows.tsx}` with local types, and the antd import in `storybook/stories/entity-ui/ObjectSchemaControl.stories.tsx`.
- [ ] 6.10 Remove `antd` and `@ant-design/icons` from `agenta-ui`, `agenta-entities`, `agenta-entity-ui`, `agenta-playground-ui` and `storybook`; regenerate the lockfile. Add `antd` and `@ant-design/*` to the `web/packages` lint bans so they cannot come back.
- [ ] 6.11 Proof: `git grep -E "from ['\"](antd|@ant-design/)"` in `web/` returns nothing; the unused-code report after the PR lists no file; CI green (lint, types, unit, mobile build and `speed:check`, storybook and website builds); `/m` screenshots of evaluations, annotations, testsets, prompts, playground, observability trace drawer (add-to-queue), agent chat and settings, before and after.
