## Context

References are to `main` at the time of writing (2026-11-16). Live frontend: `web/mobile`, Next 16.4.2, `basePath: "/m"`.

What ties the repo to the desktop app today:

1. **Theme.** `web/oss/src/styles/theme/{palette,controlScale,legacy-shim}.ts` is the source of truth. `web/scripts/generate-tailwind-tokens.ts:24-29,41-45` imports it and resolves `antd` through `createRequire(web/oss/package.json)`. `web/mobile/scripts/generate-shadcn-tokens.ts:18-19` imports `@agenta/oss/...` through the root devDep `"@agenta/oss": "link:oss"`. `web/website/tailwind.demo.config.ts:1` imports `../oss/tailwind.config`. `web/packages/agenta-ui/components.json:7-8` points into oss.
2. **Routing.** The `web` service owns `/`: Traefik `PathPrefix(/)`, nginx `location /` with a literal `web:3000` upstream (`hosting/docker-compose/oss/nginx/nginx.conf:111-113`), the Railway gateway, helm ingress `paths.web` (`templates/ingress.yaml:62-67`). Cloud ingress lives in `agenta_cloud`.
3. **Desktop gate.** `web/oss/src/middleware.ts` calls `decideDesktopGate` (`web/packages/agenta-shared/src/utils/mobileGate/index.ts`), which forwards most desktop URLs to `/m` through `mapDesktopToMobile` and keeps `/auth/callback`, `/post-signup`, `/workspaces/accept`, token links and `auth_error` links on desktop. `mapDesktopToMobile` is imperative (lines 254-366): `developerViews` from the `agenta-beta-developer-mode` cookie, `APPS_RESERVED`, query rewrites, fallback to the `/m` root. It drops `?trace=`.
4. **Reverse gate.** `/m`'s `proxy.ts` (matcher `/`, `/auth/:path*`, `/invite`, `/__gate`) calls `decideMobileGate`, which sends `agenta-classic-mode=1` users to `/w`. `mobileGateScript` does the same client-side. The Classic mode switch lives in `PreferencesTab` / `PreferencesPage`. `classicModeEnabledAtom` also feeds `BillingTab.tsx:41` (`developerMode`) and `agenta-shared/src/state/classicMode.ts:264`. `web/oss` imports `useClassicModeCookieSync` and `useClassicModeRedirect`.
5. **Links that stay forever.** The SDK builds `/w/{ws}/p/{proj}/observability?trace=` (`tracing.py:400`) and `/w/{ws}/p/{proj}/evaluations/results/{id}` (`evaluations/runs.py:199`). The API builds `/w/{org}/p/{proj}/settings?tab=workspace` (`organization_service.py:609`) and `{web_url}/assets/favicon.ico` (`tools/router.py:2223`). Old SDKs and old emails keep these in circulation.
6. **Runtime config.** `web/entrypoint.sh` writes `__env.js` into `/app/${AGENTA_LICENSE}/public` and copies it into `mobile/public`. `web/mobile/docker/Dockerfile.gh:82-83` pre-creates `/app/{oss,ee}/public`. `api/oss/tests/pytest/unit/test_web_entrypoint_email_env.py:29` asserts the oss path.
7. **Dev image.** Dev compose `web-mobile` runs `agenta-{oss,ee}-dev-web`, built from `web/{oss,ee}/docker/Dockerfile.dev`. No mobile dev Dockerfile exists.
8. **Tests.** All 43 Playwright specs live in `web/{oss,ee}/tests/playwright`; `web/tests` is only the harness. `44-railway-tests.yml` `wait-for-readiness` runs `bootstrap-auth.ts` (a desktop UI sign-in) only when the owner secrets exist; the api, sdk and services jobs read `AGENTA_AUTH_KEY` and mint their own accounts (`:386,481,563`). `wait_for "Web"` uses `curl -sfL` on the root (`:273`).
9. **Railway.** `template.json`, `bootstrap.sh`, `configure.sh`, `deploy-from-images.sh` (requires `AGENTA_WEB_IMAGE`), `deploy-services.sh`, `lib.sh:323`, `smoke.sh:94,130` (`/w`), `preview-clone-create.sh:162,651` (publishes `/w` as the preview URL), `test_preview_lifecycle.py:80,433`, `verify_preview_lifecycle.py:82`. Workflow 47 checks template drift against the live template environment.
10. **Helm.** `values.schema.json` root is open (`additionalProperties: true`); `ingress.paths` is strict (`:1205-1222`).
11. **Undeclared deps.** Storybook imports `antd` and `ai`; `agenta-entities` tests import `@tanstack/query-core`. They resolve today only through oss hoisting.

## Goals / Non-Goals

**Goals:**
- No `web/oss`, `web/ee`, `web/tests`, `web` service, or `agenta-web` image anywhere in the repo or its deploy targets.
- Every URL that worked before lands on the right `/m` page, or on the `/m` root when no page matches.
- Each PR leaves `main` deployable and ends in a state someone can check.

**Non-Goals:**
- Moving `/m` to basePath `/`.
- `/m` Playwright E2E coverage.
- Rewriting dated design docs.
- Changing SDK or backend link formats, or SuperTokens `website_base_path`.

## Decisions

### D1. Legacy URLs: redirect into `/m/legacy`, map in `proxy.ts`

`web/mobile/next.config.ts` gets `basePath: false` redirects (307) that move legacy paths under the basePath unchanged:

- `/` → `/m`
- `/auth/callback/:rest*` → `/m/auth/callback/:rest*` (replaces the one-segment rule at `next.config.ts:86`; ids can contain colons)
- `/auth/reset-password` → `/m/auth/reset-password`
- every other root path except `/m`, `/api`, `/services`, `/_next`: `/:path*` → `/m/legacy/:path*`
- `/favicon.ico`, `/assets/:path*`, `/robots.txt` → their `/m` copies

Next keeps the query string on redirects. `proxy.ts` adds `/legacy/:path*` to its matcher and answers it with `mapDesktopToMobile(originalPath, search, {developerViews: true})` → 307. `mapDesktopToMobile` stays the single owner of the mapping, with its unit tests.

Alternatives rejected:
- A `basePath: false` rewrite to an API route. Next 16.4.2 rejects internal rewrites outside the basePath at config load (`next/dist/lib/load-custom-routes.js:118-121`).
- A generated static redirect list. It copies imperative logic into 30+ entries that drift.
- Redirects in every router (Traefik, nginx, Railway gateway, helm, cloud). Five copies, and none can express the mapping.

### D2. `developerViews` is always true in the legacy handler

The `/m` developer pages already gate themselves (`<DeveloperViewGate>` in `evaluations/results/[evaluation_id].tsx`). Mapping by URL only makes old SDK links land on the right page for every browser, signed in or not, and removes the need for the `agenta-beta-developer-mode` cookie.

### D3. 307 only

Legacy redirects never use 308. A cached permanent redirect would loop if `/m` later moves to basePath `/`. "Permanent" means the code stays, not the status code.

### D4. `mapDesktopToMobile` passes `?trace=` through

The observability mapping keeps `trace` (and `session`, as today) so SDK trace links open the trace.

### D5. Remove the trip to the desktop, keep Developer Mode

The Classic mode preference is also the `/m` Developer Mode switch. `classicModeEnabledAtom` is "the one atom both apps' Preferences pages bind their Developer Mode switch to" (`agenta-shared/src/state/classicMode.ts:251`), and `betaDeveloperModeActiveAtom = classicModeEnabledAtom && betaDeveloperModeFlagAtom` gates the evaluations, annotations, testsets and prompts views in `/m` (`DeveloperViewGate`, `developerViewAccess.ts`, `developerPageFrame.ts`, `features/app-overview/*`, `features/annotations/*`, `ArchivedAppsScreen`, `BillingTab`). Removing the switch or the atoms would hide those features.

So PR 2 removes only the navigation to the desktop:
- the desktop bounce in `decideMobileGate` and `mobileGateScript`;
- `leaveForDesktop()` in `PreferencesTab` (`onClassicModeChange` and `onBetaDeveloperModeChange` only set the atoms).

The Developer Mode and beta developer mode switches, `classicModeEnabledAtom`, `betaDeveloperModeFlagAtom` and `betaDeveloperModeActiveAtom` keep their behavior in `/m`. Router config and images do not deploy atomically, so this lands before the cutover: a new router with an old `/m` image would loop a classic user between `/m` and `/w`.

PR 4 renames the classic-mode names to developer-mode names with no behavior change, and deletes what only the desktop used: the `agenta-classic-mode` and `agenta-beta-developer-mode` cookies and their writers, `useClassicModeRedirect`, `desktopEscapeHref`, `writeClassicModeCookie`.

### D6. Theme source moves by copy

`palette.ts`, `controlScale.ts`, `legacy-shim.ts` are copied into `web/packages/agenta-ui/src/styles/theme/` with a subpath export. The generator stops resolving `antd` from oss and stops writing `antd-overrides.generated.ts`. `web/oss` keeps its frozen copy until deletion; zero edits to `web/oss`. Proof: regenerated `theme-variables.css` and `theme.generated.css` are byte-identical.

### D7. No CI auth bootstrap replacement

`bootstrap-auth.ts` gives nothing to the downstream jobs. PR 3 deletes the `auth_bootstrap` steps and `run-web-tests` together. `wait_for "Web"` follows `/` → `/m` and needs `/m` to answer 200 signed out.

### D8. Helm keeps `ingress.paths.web` as the root route

`ingress.paths.web` keeps its name and settings and now routes to the `web-mobile` service. Users' `pathType` customizations (GKE, ALB) keep working. The `web` deployment, service and image helpers go. The top-level `web` values key is ignored; the open root schema already accepts it.

### D9. nginx uses a variable upstream for the catch-all

`location /` uses `set $mobile_upstream` with the resolver, like the `/m` blocks. A literal upstream fails nginx startup on `run.sh --no-web` stacks, where `web-mobile` is scaled to 0.

### D10. Soak with an exit criterion

After the cutover, `proxy.ts` logs the path (no query, no user data) of each legacy request and each `/m/legacy` fallback to the `/m` root. Exit: 7 days on cloud with no unmapped path that has a `/m` page. Rollback for cloud during the soak: revert the ingress and pin the last `agenta-web` tag. Self-hosters roll back by restoring the old compose file or chart; the upgrade note says so. `agenta-web` keeps being built until the delete PR so the pinned tag matches recent API changes.

### D11. Dated design docs stay

`docs/design/**` (except `docs/design/testing/**`) and archived openspec changes keep their paths as history. `docs/design/README.md` gets one note. A CI grep guard blocks new mentions outside this allowlist: `docs/design/**` except `testing/`, `openspec/changes/archive/**`, `docs/versioned_docs/**`, `.gitleaksignore`, `web/website/src/components/workspace-demo/fixtures.js`, this change folder.

## PR stack

Five PRs. PR 1 and PR 2 branch from `main` on their own. PR 3 stacks on both. PR 4 and PR 5 form a second stack, started after the soak. Each PR keeps one commit per concern so a reviewer can read it in parts.

| PR | Title | Contents | Depends on |
|---|---|---|---|
| 1 | `refactor(frontend): stop depending on web/oss from live code` | Theme source into `@agenta/ui` (D6); declare deps hidden by oss hoisting | — |
| 2 | `feat(frontend): /m answers legacy desktop URLs and stops sending users to the desktop` | Legacy URL handler (D1–D4); desktop trip removal, Developer Mode kept (D5) | — |
| 3 | `feat(hosting): route / to web-mobile and retire the web service` | Compose, nginx, helm, Railway, CI, upgrade note (D7–D9) | 1, 2 |
| — | soak (D10) | | 3 live on cloud |
| 4 | `chore(frontend): delete web/oss, web/ee and web/tests` | Delete the folders, their tooling, images and deps; rewrite docs and instructions; add the grep guard (D11) | 3, soak |
| 5 | `refactor(frontend): remove desktop-only package code and antd` | Desktop gate code; package files and exports nothing live uses; `@agenta/annotation-ui`; antd components in `@agenta/playground-ui`; antd and `@ant-design/*` out of every package (D12) | 4 |

### D12. Package code follows its last consumer

After PR 4, the live consumers are `web/mobile`, `web/website`, `web/storybook` and package unit tests. Package code that none of them reaches is deleted in PR 5, not kept "in case". This includes all of `@agenta/annotation-ui` and the antd components in `@agenta/playground-ui`: a static trace on 2026-11-16 found no antd module reached from `/m` at runtime. The only live antd uses are type imports in `@agenta/ui`'s `InfiniteVirtualTable` and one story; they get local types. Then `antd` and `@ant-design/*` leave every `package.json` and a lint ban keeps them out. The trace is redone with `knip` at the start of PR 5, because `web/oss` was still a consumer when the baseline was taken.

## Risks / Trade-offs

- [PR 5 deletes a component that `/m` reaches only through a dynamic path the trace missed] → the `/m` build, `speed:check` and the screenshot set catch it; the `knip` report lists every entry it used.

- [Two redirect hops for `/w/*`] → Accepted; it keeps one owner of the mapping. Both hops are 307 and cheap.
- [An unmapped legacy path lands on the `/m` root] → D10 logging finds it during the soak; add a mapping before the delete PR.
- [Self-hosters update the router but not the mobile tag] → `/` returns a 404 until they do. The upgrade note says to update both together.
- [External `agenta_cloud` repo] → PR 3 needs a matching cloud ingress change after the PR 2 image is live; PR 4 needs the cloud release workflow to stop publishing `agenta-web` and `internal-ee-agenta-web` first.
- [No browser E2E after `web/tests` goes] → The PR 3 curl table runs in `smoke.sh`. `/m` E2E is a named follow-up.
- [Two theme copies between PR 1 and PR 4] → The desktop copy is frozen and unused by `/m`; instructions point only at the new one from PR 1.

## Migration Plan

1. PR 1 and PR 2 land in any order.
2. Release with PR 2 in the `agenta-web-mobile` image. Confirm it is live on cloud.
3. PR 3 lands. Cloud ingress flips. Railway `apply.sh` updates the live template; existing previews are recycled. Self-host upgrade note ships.
4. Soak (D10).
5. `agenta_cloud` stops publishing desktop images. PR 4 lands, then PR 5.

## Open Questions

- Who owns the `agenta_cloud` ingress and release changes, and in which release?
- Does `12-check-unit-tests.yml` keep its `web-only` option name (it tests `web/mobile` and packages) or rename it?
