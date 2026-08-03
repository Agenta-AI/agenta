# Agenta Mobile — WP5 Device Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**
Ship the mobile device gate (design.md "Gate and routing") so it can land **now**, while WP2/WP3b/WP4 are postponed and `/m` has no real content: server-side UA detection in new Next middlewares — forward (desktop app redirects mobile devices into `/m`) and reverse (mobile app redirects desktop devices out of `/m`) — with the deep-link map, `agenta-mobile-optout`/`agenta-mobile-optin` escape cookies, and a **runtime flag `AGENTA_MOBILE_GATE`, DEFAULT OFF**, flippable per deployment without a rebuild. With the flag off (the shipped state), request behavior is byte-identical to today. `NoMobilePageWrapper` retirement is specified as a **separate, deferred, flag-flip-coupled commit** and is NOT executed in this plan's run.

**Architecture**
A pure, framework-free decision core (`@agenta/shared/utils/mobileGate`: detection, document-navigation guard, deep-link maps, cookie semantics, exceptions) is unit-tested once in the shared package's existing vitest harness. Three thin adapters wrap it: NEW `web/oss/src/middleware.ts` and NEW `web/ee/src/middleware.ts` import the canonical core (web/oss already depends on and transpiles `@agenta/shared`); NEW `web/mobile/src/middleware.ts` carries a **declared verbatim copy** of the reverse-gate subset (the mobile app deliberately has zero workspace deps until WP2 — WP3a's copy-extraction precedent, copy-header included), tested end-to-end with real `NextRequest` objects under a new minimal mobile vitest harness. All cookie-setting lives in middleware via a reserved `?view=desktop|mobile` query param, so the only UI change anywhere is one plain `<a>` footer link on the mobile placeholder page — zero desktop component edits, all desktop-side files are NEW files.

**Tech Stack**
Next.js `15.5.18` (workspace pin; Pages Router; middleware at `src/middleware.ts` in both apps since both use a `src/` dir; default edge-sandbox middleware runtime — do NOT opt into the experimental `nodejs` middleware runtime), `output: "standalone"` (the generated `server.js` runs middleware in-process on self-hosted Node), vitest `^4.1.4` (matching `@agenta/shared`/`@agenta/chat`), Playwright via the existing `web/tests` harness, Docker Compose + Traefik.

**Conventions for all commit steps:** run `git branch --show-current` first — if it prints `gitbutler/workspace`, use `but branch new <lane>` / `but commit <lane> -m "..."` per root `AGENTS.md`; the commands below assume plain git on `feat/agenta-mobile-wave-1` or a child branch. Never include Claude/Anthropic/Co-Authored-By lines in commit messages. All commands run from the repo root unless a `cd` is shown.

---

## Grounding facts (verified 2026-07-26 on `feat/agenta-mobile-wave-1`)

**Routing / deployment reality**

- **No `middleware.ts` exists anywhere under `web/`** (checked `web/oss`, `web/ee`, `web/mobile`, `web/packages`). Every desktop-side file in this plan is a NEW file → near-zero conflict risk with Arda's open FE PRs.
- Desktop app is standalone output (`web/oss/next.config.ts:15` `output: "standalone"`) and prod boots **Next's generated standalone server**, not a hand-written custom server: `hosting/docker-compose/oss/docker-compose.gh.yml:14` `command: sh -c "node ./oss/server.js"`, with `web/oss/docker/Dockerfile.gh:69` copying `.next/standalone`. The generated standalone `server.js` instantiates `NextServer`, which executes middleware in-process for self-hosted deployments — middleware is fully supported in this deployment shape, so **no fallback (inline-script / `getInitialProps`) design is needed**. Mobile mirrors this: `web/mobile/docker/Dockerfile.gh:78` `CMD ["node", "mobile/server.js"]`.
- Both apps use a `src/` directory (`web/oss/src/pages`, `web/mobile/src/pages`) → middleware placement is `src/middleware.ts` (Next convention: with `src/`, middleware sits in `src/` beside `pages/`).
- **EE is a separate Next app** with its own real pages that re-export OSS (`web/ee/src/pages/_app.tsx` → `import AppPage from "@/oss/components/pages/_app"`). A middleware in `web/oss/src` does NOT apply to the EE build → EE needs its own `web/ee/src/middleware.ts`. The `config` matcher must be statically analyzable **in the middleware file itself**, so it cannot be a cross-file re-export; the adapter is duplicated (~45 lines) with a twin-header.
- Traefik: web catch-all `` PathPrefix(`/`) `` (`hosting/docker-compose/oss/docker-compose.dev.yml:71`), mobile `` PathPrefix(`/m`) `` (`:104`, wins by rule length, **no stripprefix** — `web/mobile/next.config.ts:10` `basePath: "/m"`). Therefore the desktop middleware **never sees `/m` traffic** in composed deployments (the matcher still excludes `/m` for direct-port dev runs), and the mobile app needs its own reverse check.
- `next.config` redirects run **before** middleware in Next's request pipeline: `/` → `/w` and `/apps*` → `/w` are already handled by `web/oss/next.config.ts:29-56`; the gate therefore only ever sees post-redirect paths like `/w...`.

**Flag transport**

- The desktop runtime-config mechanism (`web/entrypoint.sh` → `public/__env.js` → `window.__env`) is **client-side only** — middleware cannot read it. The flag must ride `process.env` server-side.
- `NEXT_PUBLIC_*` vars are build-time-inlined (Next default, plus `web/oss/next.config.ts:152-158` `DefinePlugin` — note it is guarded `if (!isServer)`, so it inlines **client bundles only**; the middleware/edge compiler is a server compiler and is untouched). A **non-public** var (`AGENTA_MOBILE_GATE`) read inside the middleware function body is evaluated **at request time** on self-hosted Node (the edge-sandbox proxies `process.env` to the host process) → flag flips per deployment via compose env + container recreate, no rebuild. Task T5 live-verifies this against the exact pinned version by flipping the env on one unmodified standalone build.

**Desktop URL shapes (the deep-link map's ground truth)**

- Pages tree (OSS + EE verified): `/w/[workspace_id]/p/[project_id]/{agents, playground, prompts, observability, apps/[app_id]/playground, evaluations, testsets, settings, ...}`, plus `/auth/[[...path]]`, `/auth/callback/[[...callback]]`, `/workspaces/accept` (both editions), `/post-signup` (EE only), `/settings`, `/w`, `/w/[workspace_id]`.
- Playground deep links carry `?revisions=<revision_id,...>` (`web/oss/src/hooks/usePlaygroundNavigation.ts:102`, `web/oss/src/components/pages/agent-home/hooks/useCreateAgent.ts:114`, many more). Revision ids do **not** resolve to an agent without a data lookup → middleware cannot build a per-agent-filtered mobile list; bare playground links map to the plain sessions list (TODO table below).
- **The only session deep link on desktop today is `?session=<session_id>`** consumed by `web/oss/src/state/url/session.ts:54` (with optional `?span=` at `:55`), honored only on session-supported routes `["/observability", "/sessions"]` (`web/oss/src/state/url/routeMatchers.ts:13`) — it opens the observability SessionDrawer. `AgentChatSlice`'s `adoptSessionAtomFamily` (`web/oss/src/components/AgentChatSlice/state/sessions.ts:275`) exists for deep-link adoption but currently has **no URL-param caller** — there is no `playground?session=` route today. Hence the reverse map targets `/w/{ws}/p/{proj}/observability?session={id}` (real, works today), with a documented TODO to retarget when the playground adopts sessions from the URL.

**Detection**

- `sec-ch-ua-mobile` is a low-entropy client hint sent by Chromium on every request (`?1` mobile / `?0` desktop) without opt-in; Safari and Firefox do not send it → UA-regex fallback is mandatory (design.md requires both). Detection ambiguity falls through to the requested app (design.md "Error handling": middleware never hard-fails).

**Test harnesses**

- `web/oss` has **no unit-test runner** (no vitest/jest dep or config; the few stray `src/**/*.test.ts` files have no configured runner). The repo's unit-test precedent is per-package vitest: `web/packages/agenta-shared/vitest.config.ts` (tests in `tests/unit/**/*.test.ts`, node env). → Core logic is tested in `@agenta/shared`; `web/mobile` gains its own minimal vitest harness (new devDependency; dev-only, no image/compose impact).
- Playwright: `web/tests` workspace, config `web/tests/playwright.config.ts`, `testDir` resolves to `web/{license}/tests/playwright/{layer}` (`web/tests/playwright/config/runtime.ts:18-20`), acceptance specs live in `web/oss/tests/playwright/acceptance/**` (e.g. `smoke.spec.ts`).

**NoMobilePageWrapper (retirement target)**

- Component: `web/oss/src/components/Placeholders/NoMobilePageWrapper/NoMobilePageWrapper.tsx` (ResizeObserver + antd overlay; dismissal not persisted) + `assets/constants.ts` (`MOBILE_UNOPTIMIZED_APP_ROUTES`). Mounted in exactly one place: `web/oss/src/components/pages/_app/index.tsx:38-43` (dynamic import) and `:93` (JSX). Only these 2 files reference it.

**Mobile app state**

- `web/mobile` has zero workspace deps; the `web-mobile` compose service mounts no `web/packages` volume and `Dockerfile.gh` copies no package manifests (docs/design/agenta-mobile/README.md "Open items": wiring must be added the moment mobile imports `@agenta/*`). WP5 lands **before** WP2 → the mobile middleware must stay dependency-free → verbatim copy with copy-header (WP3a precedent).
- Placeholder page: `web/mobile/src/pages/index.tsx` (route shell, will host the "View desktop site" footer link). Turbo tasks: `@agenta/mobile#lint` inputs are `src/**` only (`web/turbo.json:135-136`) — extended in T3 to cover `tests/`.

---

## Task T1 — Gate decision core in `@agenta/shared` (TDD)

**Files**
- Create: `web/packages/agenta-shared/src/utils/mobileGate/index.ts`
- Create: `web/packages/agenta-shared/tests/unit/mobileGate.test.ts`
- Modify: `web/packages/agenta-shared/package.json` (one added `exports` line)

**Steps**

- [ ] Add the granular subpath export (keeps the middleware bundle lean — do NOT add to the `./utils` barrel, which pulls axios etc. into the edge bundle). In `web/packages/agenta-shared/package.json`, inside `"exports"` after the `"./utils"` line:

```json
        "./utils/mobileGate": "./src/utils/mobileGate/index.ts",
```

- [ ] Write the failing test `web/packages/agenta-shared/tests/unit/mobileGate.test.ts`:

```typescript
import {describe, expect, it} from "vitest"

import {
    GATE_COOKIE_MAX_AGE,
    MOBILE_OPTIN_COOKIE,
    MOBILE_OPTOUT_COOKIE,
    decideDesktopGate,
    decideMobileGate,
    isDocumentNavigation,
    isMobileDevice,
    mapDesktopToMobile,
    mapMobileToDesktop,
    type GateInput,
} from "../../src/utils/mobileGate"

const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const DESKTOP_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

const input = (overrides: Partial<GateInput> & {headers?: Record<string, string>}): GateInput => {
    const {headers = {}, ...rest} = overrides
    const cookies: Record<string, string> = {}
    return {
        pathname: "/w",
        search: "",
        method: "GET",
        header: (name) => headers[name.toLowerCase()] ?? null,
        cookie: (name) => cookies[name],
        gateEnabled: true,
        ...rest,
    }
}

const docHeaders = (ua: string, extra: Record<string, string> = {}) => ({
    "user-agent": ua,
    "sec-fetch-dest": "document",
    ...extra,
})

describe("isMobileDevice", () => {
    it("trusts sec-ch-ua-mobile ?1 over a desktop UA", () => {
        expect(
            isMobileDevice((n) => ({"sec-ch-ua-mobile": "?1", "user-agent": DESKTOP_UA})[n] ?? null),
        ).toBe(true)
    })
    it("trusts sec-ch-ua-mobile ?0 over a mobile UA", () => {
        expect(
            isMobileDevice((n) => ({"sec-ch-ua-mobile": "?0", "user-agent": MOBILE_UA})[n] ?? null),
        ).toBe(false)
    })
    it("falls back to the UA regex when the hint is absent (Safari/Firefox)", () => {
        expect(isMobileDevice((n) => ({"user-agent": MOBILE_UA})[n] ?? null)).toBe(true)
        expect(isMobileDevice((n) => ({"user-agent": DESKTOP_UA})[n] ?? null)).toBe(false)
    })
    it("treats missing headers as desktop", () => {
        expect(isMobileDevice(() => null)).toBe(false)
    })
})

describe("isDocumentNavigation", () => {
    it("accepts GET document navigations", () => {
        expect(isDocumentNavigation(input({headers: docHeaders(MOBILE_UA)}))).toBe(true)
    })
    it("rejects POST", () => {
        expect(isDocumentNavigation(input({method: "POST", headers: docHeaders(MOBILE_UA)}))).toBe(
            false,
        )
    })
    it("rejects fetch/XHR (sec-fetch-dest: empty)", () => {
        expect(
            isDocumentNavigation(
                input({headers: {"user-agent": MOBILE_UA, "sec-fetch-dest": "empty"}}),
            ),
        ).toBe(false)
    })
    it("falls back to Accept when sec-fetch-dest is absent", () => {
        expect(
            isDocumentNavigation(input({headers: {"user-agent": MOBILE_UA, accept: "text/html"}})),
        ).toBe(true)
        expect(
            isDocumentNavigation(
                input({headers: {"user-agent": MOBILE_UA, accept: "application/json"}}),
            ),
        ).toBe(false)
    })
})

describe("mapDesktopToMobile", () => {
    it("maps an observability session deep link to the mobile chat", () => {
        expect(mapDesktopToMobile("/w/ws1/p/pr1/observability", "?session=abc&span=s1")).toBe(
            "/m/w/ws1/p/pr1/sessions/abc",
        )
    })
    it("maps any project-scoped route to the sessions list", () => {
        expect(mapDesktopToMobile("/w/ws1/p/pr1/apps/app1/playground", "?revisions=r1")).toBe(
            "/m/w/ws1/p/pr1/sessions",
        )
        expect(mapDesktopToMobile("/w/ws1/p/pr1/agents", "")).toBe("/m/w/ws1/p/pr1/sessions")
        expect(mapDesktopToMobile("/w/ws1/p/pr1/testsets", "")).toBe("/m/w/ws1/p/pr1/sessions")
    })
    it("maps context-free routes to the mobile root resolver", () => {
        expect(mapDesktopToMobile("/w", "")).toBe("/m/")
        expect(mapDesktopToMobile("/w/ws1", "")).toBe("/m/")
        expect(mapDesktopToMobile("/settings", "")).toBe("/m/")
    })
})

describe("mapMobileToDesktop", () => {
    it("maps a mobile session chat to the observability session drawer", () => {
        expect(mapMobileToDesktop("/w/ws1/p/pr1/sessions/abc")).toBe(
            "/w/ws1/p/pr1/observability?session=abc",
        )
    })
    it("maps the sessions list to observability", () => {
        expect(mapMobileToDesktop("/w/ws1/p/pr1/sessions")).toBe("/w/ws1/p/pr1/observability")
    })
    it("maps mobile auth to desktop auth and unknown paths to /w", () => {
        expect(mapMobileToDesktop("/auth")).toBe("/auth")
        expect(mapMobileToDesktop("/")).toBe("/w")
    })
})

describe("decideDesktopGate", () => {
    it("passes when the flag is off, whatever the device", () => {
        expect(
            decideDesktopGate(input({gateEnabled: false, headers: docHeaders(MOBILE_UA)})),
        ).toEqual({kind: "pass"})
    })
    it("redirects a mobile document navigation into /m", () => {
        expect(
            decideDesktopGate(
                input({pathname: "/w/ws1/p/pr1/agents", headers: docHeaders(MOBILE_UA)}),
            ),
        ).toEqual({kind: "redirect", location: "/m/w/ws1/p/pr1/sessions"})
    })
    it("never redirects the documented exceptions", () => {
        for (const pathname of ["/auth", "/auth/callback", "/post-signup", "/workspaces/accept"]) {
            expect(decideDesktopGate(input({pathname, headers: docHeaders(MOBILE_UA)}))).toEqual({
                kind: "pass",
            })
        }
    })
    it("honors the opt-out cookie", () => {
        const i = input({headers: docHeaders(MOBILE_UA)})
        i.cookie = (name) => (name === MOBILE_OPTOUT_COOKIE ? "1" : undefined)
        expect(decideDesktopGate(i)).toEqual({kind: "pass"})
    })
    it("passes desktop devices through", () => {
        expect(decideDesktopGate(input({headers: docHeaders(DESKTOP_UA)}))).toEqual({kind: "pass"})
    })
    it("sets the opt-out cookie and strips the reserved param on ?view=desktop", () => {
        expect(
            decideDesktopGate(
                input({pathname: "/w", search: "?view=desktop", headers: docHeaders(MOBILE_UA)}),
            ),
        ).toEqual({
            kind: "set-cookie-redirect",
            cookie: MOBILE_OPTOUT_COOKIE,
            clearCookie: MOBILE_OPTIN_COOKIE,
            location: "/w",
        })
    })
    it("never hard-fails: a throwing header reader falls through to pass", () => {
        const i = input({})
        i.header = () => {
            throw new Error("boom")
        }
        expect(decideDesktopGate(i)).toEqual({kind: "pass"})
    })
})

describe("decideMobileGate", () => {
    it("passes when the flag is off", () => {
        expect(
            decideMobileGate(
                input({gateEnabled: false, pathname: "/", headers: docHeaders(DESKTOP_UA)}),
            ),
        ).toEqual({kind: "pass"})
    })
    it("redirects a desktop document navigation to the desktop equivalent", () => {
        expect(
            decideMobileGate(
                input({pathname: "/w/ws1/p/pr1/sessions/abc", headers: docHeaders(DESKTOP_UA)}),
            ),
        ).toEqual({kind: "redirect", location: "/w/ws1/p/pr1/observability?session=abc"})
    })
    it("honors the opt-in cookie (desktop user chose mobile)", () => {
        const i = input({pathname: "/", headers: docHeaders(DESKTOP_UA)})
        i.cookie = (name) => (name === MOBILE_OPTIN_COOKIE ? "1" : undefined)
        expect(decideMobileGate(i)).toEqual({kind: "pass"})
    })
    it("passes mobile devices through", () => {
        expect(decideMobileGate(input({pathname: "/", headers: docHeaders(MOBILE_UA)}))).toEqual({
            kind: "pass",
        })
    })
    it("sets the opt-in cookie and strips the reserved param on ?view=mobile", () => {
        expect(
            decideMobileGate(
                input({pathname: "/", search: "?view=mobile", headers: docHeaders(DESKTOP_UA)}),
            ),
        ).toEqual({
            kind: "set-cookie-redirect",
            cookie: MOBILE_OPTIN_COOKIE,
            clearCookie: MOBILE_OPTOUT_COOKIE,
            location: "/",
        })
    })
})

describe("cookie policy", () => {
    it("cookies persist ~180 days", () => {
        expect(GATE_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 180)
    })
})
```

- [ ] Run: `cd web && pnpm --filter @agenta/shared test:unit -- mobileGate` — expect FAIL (module does not exist).
- [ ] Create `web/packages/agenta-shared/src/utils/mobileGate/index.ts`:

```typescript
/**
 * Mobile device gate — pure decision core (agenta-mobile WP5).
 *
 * Framework-free: the Next middlewares (desktop forward gate in web/oss +
 * web/ee, mobile reverse gate in web/mobile) adapt NextRequest into a
 * `GateInput` and apply the returned `GateDecision`. Keeping the logic pure
 * means detection, the deep-link map, cookie semantics, and the documented
 * exceptions are all unit-tested here without NextRequest mocks.
 *
 * web/mobile carries a DECLARED VERBATIM COPY of the reverse-gate subset
 * (it has no workspace deps until WP2 wires @agenta/* into its compose
 * service and Dockerfile) — see the copy header in web/mobile/src/middleware.ts.
 * Behavior changes must land here first, then be mirrored there.
 */

export const MOBILE_OPTOUT_COOKIE = "agenta-mobile-optout"
export const MOBILE_OPTIN_COOKIE = "agenta-mobile-optin"
/** Reserved query param: `view=desktop` | `view=mobile` set the escape cookies. */
export const VIEW_PARAM = "view"
/** 180 days, in seconds. */
export const GATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 180

export interface GateInput {
    /** `nextUrl.pathname`, WITHOUT the app basePath (`/m` already stripped). */
    pathname: string
    /** `nextUrl.search` including the leading `?`, or "". */
    search: string
    method: string
    /** Case-insensitive header getter (NextRequest headers already are). */
    header: (name: string) => string | null
    cookie: (name: string) => string | undefined
    /** AGENTA_MOBILE_GATE, resolved by the adapter at request time. */
    gateEnabled: boolean
}

export type GateDecision =
    | {kind: "pass"}
    | {kind: "redirect"; location: string}
    | {kind: "set-cookie-redirect"; cookie: string; clearCookie: string; location: string}

/** UA fallback for browsers that send no client hints (Safari, Firefox). */
const MOBILE_UA_RE = /Android|iPhone|iPod|iPad|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i

export function isMobileDevice(header: GateInput["header"]): boolean {
    const hint = header("sec-ch-ua-mobile")
    if (hint === "?1") return true
    if (hint === "?0") return false
    return MOBILE_UA_RE.test(header("user-agent") ?? "")
}

/** Only gate top-level document navigations — never assets, fetches, or POSTs. */
export function isDocumentNavigation(input: Pick<GateInput, "method" | "header">): boolean {
    if (input.method !== "GET" && input.method !== "HEAD") return false
    const dest = input.header("sec-fetch-dest")
    if (dest) return dest === "document"
    return (input.header("accept") ?? "").includes("text/html")
}

/**
 * Desktop routes that must never redirect to /m (design.md documented
 * exceptions). /auth stays here until WP2 ships the mobile sign-in, then
 * moves into the map (→ /m/auth); /post-signup and /workspaces/accept are
 * permanently desktop-only.
 */
const DESKTOP_EXCEPTIONS = [/^\/auth(\/|$)/, /^\/post-signup(\/|$)/, /^\/workspaces\/accept(\/|$)/]

const PROJECT_PATH_RE = /^\/w\/([^/]+)\/p\/([^/]+)(\/|$)/

/** Desktop URL → mobile equivalent (design.md "Gate and routing"). */
export function mapDesktopToMobile(pathname: string, search: string): string {
    const m = pathname.match(PROJECT_PATH_RE)
    if (m) {
        const [, ws, proj] = m
        // /observability?session={id} is the desktop session deep link today
        // (web/oss/src/state/url/session.ts) — land in that session's chat.
        const sessionId = new URLSearchParams(search).get("session")
        if (sessionId && /\/observability(\/|$)/.test(pathname)) {
            return `/m/w/${ws}/p/${proj}/sessions/${encodeURIComponent(sessionId)}`
        }
        return `/m/w/${ws}/p/${proj}/sessions`
    }
    // No project context: the mobile root resolves last-used workspace/project
    // (same resolution as post-login) and forwards to the sessions list.
    return "/m/"
}

/** Mobile URL (basePath already stripped) → desktop equivalent. */
export function mapMobileToDesktop(pathname: string): string {
    const m = pathname.match(/^\/w\/([^/]+)\/p\/([^/]+)\/sessions(?:\/([^/]+))?\/?$/)
    if (m) {
        const [, ws, proj, sessionId] = m
        const base = `/w/${ws}/p/${proj}/observability`
        // Desktop opens sessions via the observability SessionDrawer today.
        // TODO(post-WP5): retarget to the agent playground once it adopts
        // sessions from the URL (adoptSessionAtomFamily has no URL caller yet).
        return sessionId ? `${base}?session=${encodeURIComponent(sessionId)}` : base
    }
    if (/^\/auth(\/|$)/.test(pathname)) return "/auth"
    return "/w"
}

function stripViewParam(pathname: string, search: string): string {
    const params = new URLSearchParams(search)
    params.delete(VIEW_PARAM)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
}

/** Forward gate: runs in the DESKTOP apps. Sees no /m traffic behind Traefik. */
export function decideDesktopGate(input: GateInput): GateDecision {
    try {
        if (!input.gateEnabled) return {kind: "pass"}
        if (!isDocumentNavigation(input)) return {kind: "pass"}

        // Escape hatch: "View desktop site" links carry ?view=desktop.
        if (new URLSearchParams(input.search).get(VIEW_PARAM) === "desktop") {
            return {
                kind: "set-cookie-redirect",
                cookie: MOBILE_OPTOUT_COOKIE,
                clearCookie: MOBILE_OPTIN_COOKIE,
                location: stripViewParam(input.pathname, input.search),
            }
        }

        if (DESKTOP_EXCEPTIONS.some((re) => re.test(input.pathname))) return {kind: "pass"}
        if (input.cookie(MOBILE_OPTOUT_COOKIE)) return {kind: "pass"}
        if (!isMobileDevice(input.header)) return {kind: "pass"}

        return {kind: "redirect", location: mapDesktopToMobile(input.pathname, input.search)}
    } catch {
        // Design rule: the gate never hard-fails — ambiguity falls through.
        return {kind: "pass"}
    }
}

/** Reverse gate: runs in the MOBILE app. Sees only /m traffic behind Traefik. */
export function decideMobileGate(input: GateInput): GateDecision {
    try {
        if (!input.gateEnabled) return {kind: "pass"}
        if (!isDocumentNavigation(input)) return {kind: "pass"}

        // Escape hatch: "Open mobile version" links carry ?view=mobile.
        if (new URLSearchParams(input.search).get(VIEW_PARAM) === "mobile") {
            return {
                kind: "set-cookie-redirect",
                cookie: MOBILE_OPTIN_COOKIE,
                clearCookie: MOBILE_OPTOUT_COOKIE,
                location: stripViewParam(input.pathname, input.search),
            }
        }

        if (input.cookie(MOBILE_OPTIN_COOKIE)) return {kind: "pass"}
        if (isMobileDevice(input.header)) return {kind: "pass"}

        return {kind: "redirect", location: mapMobileToDesktop(input.pathname)}
    } catch {
        return {kind: "pass"}
    }
}
```

- [ ] Run: `cd web && pnpm --filter @agenta/shared test:unit -- mobileGate` — expect **38 passed**
  (25 at the time this step was written; the file grew with the OAuth-callback handback and the
  token-bearing `/auth` pass-through). Assert the suite is green, not a fixed number.
- [ ] Run: `cd web && pnpm --filter @agenta/shared check` — expect types + lint clean.
- [ ] Commit:

```bash
git add web/packages/agenta-shared
git commit -m "feat(shared): add mobile device gate decision core (WP5)"
```

---

## Task T2 — Desktop middleware adapters (`web/oss` + `web/ee`, NEW files only)

**Files**
- Create: `web/oss/src/middleware.ts`
- Create: `web/ee/src/middleware.ts` (byte-identical; twin-header noted)

**Steps**

- [ ] Create `web/oss/src/middleware.ts`:

```typescript
import {NextRequest, NextResponse} from "next/server"

import {GATE_COOKIE_MAX_AGE, decideDesktopGate} from "@agenta/shared/utils/mobileGate"

/**
 * Mobile device gate, forward direction (agenta-mobile WP5): mobile devices
 * navigating desktop routes are redirected into the /m app.
 *
 * DEFAULT OFF. Activates only when the deployment sets AGENTA_MOBILE_GATE=true.
 * The flag is read inside the handler at request time: on the self-hosted
 * standalone Node server, non-NEXT_PUBLIC process.env is resolved at runtime
 * (the client-only DefinePlugin in next.config.ts does not touch this
 * compiler), so flipping the env + recreating the container is enough — no
 * rebuild. Behind Traefik this middleware never sees /m traffic
 * (PathPrefix(`/m`) routes to the mobile app); the matcher still excludes /m
 * for direct-port dev runs.
 *
 * TWIN NOTE: web/ee/src/middleware.ts is a byte-identical copy (EE is a
 * separate Next app and the matcher config must be static per file).
 */
export function middleware(request: NextRequest) {
    const decision = decideDesktopGate({
        pathname: request.nextUrl.pathname,
        search: request.nextUrl.search,
        method: request.method,
        header: (name) => request.headers.get(name),
        cookie: (name) => request.cookies.get(name)?.value,
        gateEnabled: process.env.AGENTA_MOBILE_GATE === "true",
    })

    if (decision.kind === "redirect") {
        return NextResponse.redirect(new URL(decision.location, request.url), 307)
    }
    if (decision.kind === "set-cookie-redirect") {
        const response = NextResponse.redirect(new URL(decision.location, request.url), 307)
        response.cookies.set(decision.cookie, "1", {
            path: "/",
            maxAge: GATE_COOKIE_MAX_AGE,
            sameSite: "lax",
        })
        response.cookies.set(decision.clearCookie, "", {path: "/", maxAge: 0})
        return response
    }
    return NextResponse.next()
}

export const config = {
    // Infra/static exclusions only; product-route exceptions (auth,
    // post-signup, invite accept) live in decideDesktopGate so they are
    // unit-tested. `.*\\..*` skips any path containing a file extension.
    matcher: ["/((?!api|_next|m/|m$|__env\\.js|.*\\..*).*)"],
}
```

- [ ] Copy the file verbatim to `web/ee/src/middleware.ts` (keep the TWIN NOTE; swap the note to point back at `web/oss/src/middleware.ts`).
- [ ] Run: `cd web && pnpm --filter @agenta/oss types:check` and `pnpm --filter @agenta/ee types:check` — expect clean (the `@agenta/shared` subpath resolves; both apps already depend on and transpile the package).
- [ ] Build proof: `cd web && pnpm build-oss` — expect the build summary to list `ƒ Middleware` (Next prints a middleware row when one is bundled). This confirms placement (`src/middleware.ts`) is picked up by the pinned 15.5.18.
- [ ] Flag-off regression check (dev): `cd web && pnpm dev-oss` → open http://localhost:3000/w with a mobile-device emulator (Chrome devtools) — expect NO redirect (flag unset), identical behavior to today.
- [ ] Commit:

```bash
git add web/oss/src/middleware.ts web/ee/src/middleware.ts
git commit -m "feat(frontend): add flag-gated mobile device gate middleware (default off)"
```

---

## Task T3 — Mobile reverse middleware + vitest harness + escape link (TDD)

**Files**
- Create: `web/mobile/src/middleware.ts`
- Create: `web/mobile/vitest.config.ts`
- Create: `web/mobile/tests/unit/middleware.test.ts`
- Modify: `web/mobile/package.json` (vitest devDep + `test` scripts; extend `lint` to cover `tests/`)
- Modify: `web/mobile/src/pages/index.tsx` (footer link)
- Modify: `web/turbo.json` (`@agenta/mobile#lint` inputs + `tests/**`)

**Steps**

- [ ] Add the harness. `web/mobile/vitest.config.ts`:

```typescript
import {defineConfig} from "vitest/config"

export default defineConfig({
    test: {
        include: ["tests/unit/**/*.test.ts"],
        environment: "node",
    },
})
```

- [ ] In `web/mobile/package.json`: add to `devDependencies` `"vitest": "^4.1.4"`; add scripts `"test": "vitest run"` and `"test:watch": "vitest"`; change `"lint"` to `"eslint src tests && pnpm run tokens:check"` and `"lint:fix"` to `"eslint src tests --fix"`. Then `cd web && pnpm install`.
- [ ] In `web/turbo.json`, extend `@agenta/mobile#lint` inputs to `["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "eslint.config.*"]`.
- [ ] Write the failing tests `web/mobile/tests/unit/middleware.test.ts` — real `NextRequest`, no mocks (this is the repo's first middleware test; the harness is just vitest node env + `next/server`, which runs fine on Node 24 since `Request`/`Headers` are global):

```typescript
import {NextRequest} from "next/server"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {middleware} from "../../src/middleware"

const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const DESKTOP_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

const req = (path: string, headers: Record<string, string>) =>
    new NextRequest(`http://localhost:3000${path}`, {headers})

const doc = (ua: string, extra: Record<string, string> = {}) => ({
    "user-agent": ua,
    "sec-fetch-dest": "document",
    ...extra,
})

let savedFlag: string | undefined

beforeEach(() => {
    savedFlag = process.env.AGENTA_MOBILE_GATE
    process.env.AGENTA_MOBILE_GATE = "true"
})

afterEach(() => {
    if (savedFlag === undefined) delete process.env.AGENTA_MOBILE_GATE
    else process.env.AGENTA_MOBILE_GATE = savedFlag
})

describe("mobile reverse gate middleware", () => {
    it("passes everything through when the flag is off", () => {
        process.env.AGENTA_MOBILE_GATE = "false"
        const res = middleware(req("/m/", doc(DESKTOP_UA)))
        expect(res.headers.get("location")).toBeNull()
    })

    it("redirects a desktop UA on a mobile session URL to the desktop equivalent", () => {
        // Unit tests hit the handler without the Next server, so the /m
        // basePath is still present in nextUrl — the middleware strips it
        // defensively (at runtime Next strips it before the handler runs).
        const res = middleware(req("/m/w/ws1/p/pr1/sessions/abc", doc(DESKTOP_UA)))
        expect(res.status).toBe(307)
        expect(res.headers.get("location")).toBe(
            "http://localhost:3000/w/ws1/p/pr1/observability?session=abc",
        )
    })

    it("redirects the mobile root to /w for desktop UAs", () => {
        const res = middleware(req("/m", doc(DESKTOP_UA)))
        expect(res.headers.get("location")).toBe("http://localhost:3000/w")
    })

    it("lets mobile devices through (sec-ch-ua-mobile wins over UA)", () => {
        const res = middleware(
            req("/m/", doc(DESKTOP_UA, {"sec-ch-ua-mobile": "?1"})),
        )
        expect(res.headers.get("location")).toBeNull()
    })

    it("honors the opt-in cookie for desktop UAs", () => {
        const res = middleware(
            req("/m/", doc(DESKTOP_UA, {cookie: "agenta-mobile-optin=1"})),
        )
        expect(res.headers.get("location")).toBeNull()
    })

    it("does not redirect non-document requests", () => {
        const res = middleware(
            req("/m/", {"user-agent": DESKTOP_UA, "sec-fetch-dest": "empty"}),
        )
        expect(res.headers.get("location")).toBeNull()
    })

    it("?view=mobile sets the opt-in cookie and stays in /m", () => {
        const res = middleware(req("/m/?view=mobile", doc(DESKTOP_UA)))
        expect(res.status).toBe(307)
        expect(res.headers.get("location")).toBe("http://localhost:3000/m/")
        const setCookie = res.headers.get("set-cookie") ?? ""
        expect(setCookie).toContain("agenta-mobile-optin=1")
        expect(setCookie).toContain("Path=/")
    })

    it("mobile UA passes untouched (no cookie, no redirect)", () => {
        const res = middleware(req("/m/", doc(MOBILE_UA)))
        expect(res.headers.get("location")).toBeNull()
        expect(res.headers.get("set-cookie")).toBeNull()
    })
})
```

- [ ] Run: `cd web && pnpm --filter @agenta/mobile test` — expect FAIL (no middleware yet).
- [ ] Create `web/mobile/src/middleware.ts`:

```typescript
import {NextRequest, NextResponse} from "next/server"

/**
 * Mobile device gate, reverse direction (agenta-mobile WP5): desktop devices
 * navigating /m are redirected to the desktop equivalent. DEFAULT OFF —
 * activates only when the deployment sets AGENTA_MOBILE_GATE=true (read at
 * request time; runtime-flippable on the standalone Node server).
 *
 * COPY of @agenta/shared/src/utils/mobileGate (reverse-gate subset).
 * web/mobile deliberately has zero workspace deps until WP2 wires @agenta/*
 * into the mobile compose service and Dockerfile (see
 * docs/design/agenta-mobile/README.md "Open items"). When WP2 lands, replace
 * these copies with the @agenta/shared import and delete the twins.
 * Declared adaptations vs the canonical source: none (verbatim functions);
 * this file adds only the NextRequest adapter and basePath handling.
 * Canonical tests: web/packages/agenta-shared/tests/unit/mobileGate.test.ts.
 */

const MOBILE_OPTOUT_COOKIE = "agenta-mobile-optout"
const MOBILE_OPTIN_COOKIE = "agenta-mobile-optin"
const VIEW_PARAM = "view"
const GATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 180

const MOBILE_UA_RE = /Android|iPhone|iPod|iPad|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i

function isMobileDevice(header: (name: string) => string | null): boolean {
    const hint = header("sec-ch-ua-mobile")
    if (hint === "?1") return true
    if (hint === "?0") return false
    return MOBILE_UA_RE.test(header("user-agent") ?? "")
}

function isDocumentNavigation(method: string, header: (name: string) => string | null): boolean {
    if (method !== "GET" && method !== "HEAD") return false
    const dest = header("sec-fetch-dest")
    if (dest) return dest === "document"
    return (header("accept") ?? "").includes("text/html")
}

function mapMobileToDesktop(pathname: string): string {
    const m = pathname.match(/^\/w\/([^/]+)\/p\/([^/]+)\/sessions(?:\/([^/]+))?\/?$/)
    if (m) {
        const [, ws, proj, sessionId] = m
        const base = `/w/${ws}/p/${proj}/observability`
        // TODO(post-WP5): retarget to the agent playground once it adopts
        // sessions from the URL.
        return sessionId ? `${base}?session=${encodeURIComponent(sessionId)}` : base
    }
    if (/^\/auth(\/|$)/.test(pathname)) return "/auth"
    return "/w"
}

function stripViewParam(pathname: string, search: string): string {
    const params = new URLSearchParams(search)
    params.delete(VIEW_PARAM)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
}

export function middleware(request: NextRequest) {
    try {
        if (process.env.AGENTA_MOBILE_GATE !== "true") return NextResponse.next()

        const header = (name: string) => request.headers.get(name)
        if (!isDocumentNavigation(request.method, header)) return NextResponse.next()

        // At runtime Next strips basePath ("/m") from nextUrl before the
        // handler; unit tests construct NextRequest directly, so normalize.
        const raw = request.nextUrl.pathname
        const pathname =
            raw === "/m" ? "/" : raw.startsWith("/m/") ? raw.slice("/m".length) : raw
        const search = request.nextUrl.search

        // Escape hatch: "Open mobile version" links carry ?view=mobile.
        if (new URLSearchParams(search).get(VIEW_PARAM) === "mobile") {
            const stayPath = stripViewParam(pathname, search)
            const target = stayPath === "/" ? "/m/" : `/m${stayPath}`
            const response = NextResponse.redirect(new URL(target, request.url), 307)
            response.cookies.set(MOBILE_OPTIN_COOKIE, "1", {
                path: "/",
                maxAge: GATE_COOKIE_MAX_AGE,
                sameSite: "lax",
            })
            response.cookies.set(MOBILE_OPTOUT_COOKIE, "", {path: "/", maxAge: 0})
            return response
        }

        if (request.cookies.get(MOBILE_OPTIN_COOKIE)?.value) return NextResponse.next()
        if (isMobileDevice(header)) return NextResponse.next()

        return NextResponse.redirect(new URL(mapMobileToDesktop(pathname), request.url), 307)
    } catch {
        // Design rule: the gate never hard-fails.
        return NextResponse.next()
    }
}

export const config = {
    matcher: ["/((?!_next|__env\\.js|.*\\..*).*)"],
}
```

- [ ] Run: `cd web && pnpm --filter @agenta/mobile test` — expect **8 passed**.
- [ ] Add the "View desktop site" escape link. Replace `web/mobile/src/pages/index.tsx` with:

```tsx
import Head from "next/head"

// Placeholder route shell: proves the scaffold end to end (basePath, Tailwind
// v4, palette-bridged tokens, dark mode). Replaced in WP2 by context
// resolution (last-used workspace/project) + redirect to the sessions list.
// The footer link is the WP5 gate escape hatch: a plain <a> (next/link would
// prefix the /m basePath) to a desktop URL carrying ?view=desktop, which the
// desktop middleware turns into the agenta-mobile-optout cookie.
export default function Home() {
    return (
        <>
            <Head>
                <title>Agenta Mobile</title>
            </Head>
            <div className="flex min-h-dvh flex-col bg-background text-foreground">
                <main className="flex grow flex-col items-center justify-center gap-2 p-6">
                    <h1 className="text-2xl font-semibold">Agenta Mobile</h1>
                    <p className="text-muted-foreground text-sm">
                        Foundation scaffold is alive under <code>/m</code>.
                    </p>
                </main>
                <footer className="pb-8 text-center">
                    <a
                        href="/w?view=desktop"
                        className="text-muted-foreground text-sm underline underline-offset-4"
                    >
                        View desktop site
                    </a>
                </footer>
            </div>
        </>
    )
}
```

- [ ] Run: `cd web && pnpm --filter @agenta/mobile lint && pnpm --filter @agenta/mobile types:check` — expect clean.
- [ ] Run: `cd web && pnpm build-mobile` — expect success with a `ƒ Middleware` row; verify `test -f web/mobile/.next/standalone/mobile/server.js`.
- [ ] Commit:

```bash
git add web/mobile web/turbo.json web/pnpm-lock.yaml
git commit -m "feat(mobile): add reverse device gate middleware and desktop-site escape link"
```

---

## Task T4 — Flag plumbing through compose (default off)

**Files**
- Modify: `hosting/docker-compose/oss/docker-compose.dev.yml` (`web` + `web-mobile` services)
- Modify: `hosting/docker-compose/ee/docker-compose.dev.yml` (`web` + `web-mobile` services)
- Modify: `hosting/docker-compose/oss/docker-compose.gh.yml` (`web` service)
- Modify: `hosting/docker-compose/ee/docker-compose.gh.yml` (`web` service)
- Modify: `hosting/docker-compose/oss/env.oss.dev.example`, `hosting/docker-compose/ee/env.ee.dev.example` (documented, commented-out)

**Steps**

- [ ] In each dev compose file, add to the `environment:` block of BOTH `web` and `web-mobile` services (dev-yml uses map syntax):

```yaml
            AGENTA_MOBILE_GATE: ${AGENTA_MOBILE_GATE:-false}
```

- [ ] In each gh compose file's `web` service (list syntax elsewhere in those files; `web` currently has no `environment:` block — add one):

```yaml
        environment:
            - AGENTA_MOBILE_GATE=${AGENTA_MOBILE_GATE:-false}
```

- [ ] Append to both dev env examples:

```bash
# Mobile device gate (WP5). Redirects mobile devices to /m and desktop
# devices out of /m. Default off; flip per deployment once /m has content.
# AGENTA_MOBILE_GATE=true
```

- [ ] Validate: `docker compose -f hosting/docker-compose/oss/docker-compose.dev.yml --env-file hosting/docker-compose/oss/env.oss.dev.example config >/dev/null && echo OK` (repeat for the ee dev file and both gh files with their env examples) — expect `OK` each time.
- [ ] Note for the gh flow: the gh compose files have no `web-mobile` service yet (prod mobile compose wiring is the WP1 infra-tail plan); when that service is added, give it the same env line. Recorded in "Not in this plan".
- [ ] Commit:

```bash
git add hosting/docker-compose
git commit -m "chore(hosting): plumb AGENTA_MOBILE_GATE through compose (default off)"
```

---

## Task T5 — Live verification of the runtime flag (no rebuild between flips)

This is the load-bearing verification that `process.env` in middleware is request-time on the pinned Next 15.5.18 standalone server. One build, two runs.

- [ ] Build once (already done in T2/T3): `cd web && pnpm build-oss && pnpm build-mobile`.
- [ ] Desktop forward gate, flag ON:

```bash
cd web && AGENTA_MOBILE_GATE=true PORT=3999 HOSTNAME=127.0.0.1 node oss/.next/standalone/oss/server.js &
sleep 3
curl -s -o /dev/null -D - \
  -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" \
  -H "sec-fetch-dest: document" -H "accept: text/html" \
  http://127.0.0.1:3999/w | grep -iE "^HTTP|^location"
# EXPECT: HTTP/1.1 307 ... / location: /m/
curl -s -o /dev/null -D - \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/126.0" \
  -H "sec-fetch-dest: document" -H "accept: text/html" \
  http://127.0.0.1:3999/w | grep -iE "^HTTP|^location"
# EXPECT: HTTP/1.1 200 (no location header)
kill %1
```

- [ ] Same binary, flag OFF: rerun WITHOUT `AGENTA_MOBILE_GATE`, repeat the mobile-UA curl — expect **200, no redirect**. This proves runtime-read (no rebuild happened). If this step ever failed (redirect still active), the flag was inlined — fallback design: have Traefik inject a header (`traefik.http.middlewares...headers.customrequestheaders.X-Agenta-Mobile-Gate=true`) and read `request.headers.get("x-agenta-mobile-gate")` instead. **Not expected to be needed.**
- [ ] Mobile reverse gate, same procedure:

```bash
cd web && AGENTA_MOBILE_GATE=true PORT=3998 HOSTNAME=127.0.0.1 node mobile/.next/standalone/mobile/server.js &
sleep 3
curl -s -o /dev/null -D - -A "Mozilla/5.0 (Macintosh; ...) Chrome/126.0" \
  -H "sec-fetch-dest: document" -H "accept: text/html" \
  http://127.0.0.1:3998/m/w/ws1/p/pr1/sessions/abc | grep -iE "^HTTP|^location"
# EXPECT: 307 / location: /w/ws1/p/pr1/observability?session=abc
# also confirms whether nextUrl strips basePath at runtime (either way the
# middleware normalizes)
kill %1
```

- [ ] Optional full-stack check through Traefik: add `AGENTA_MOBILE_GATE=true` to the worktree env file and start the dev stack per `hosting/AGENTS.md`, then repeat the curls against `http://localhost:80`. Verifies the Traefik path-split (desktop middleware never sees `/m`).
- [ ] No commit (verification only). If any deviation was found, fix forward and amend the relevant commit.

---

## Task T6 — Playwright UA-emulation smoke (self-skipping unless flag on)

**Files**
- Create: `web/oss/tests/playwright/acceptance/mobile-gate/gate.spec.ts`

**Steps**

- [ ] Create the spec. It self-skips unless the runner asserts the stack has the flag on (`AGENTA_MOBILE_GATE=true` in the runner env), so CI against default-off stacks is unaffected. Pre-WP4, `/m/w/...` targets 404 inside the mobile app — the spec asserts **URLs only**; content assertions arrive with WP4.

```typescript
import {expect, test} from "@playwright/test"

const IPHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

// Requires a deployment started with AGENTA_MOBILE_GATE=true; the runner env
// var is the operator's assertion of that. Skipped otherwise.
const gateEnabled = process.env.AGENTA_MOBILE_GATE === "true"
test.skip(!gateEnabled, "mobile gate flag off (set AGENTA_MOBILE_GATE=true to run)")

test.describe("mobile gate: forward direction", () => {
    test.use({userAgent: IPHONE_UA, storageState: undefined})

    test("mobile UA on a desktop route lands in /m", async ({page}) => {
        await page.goto("/w")
        await expect(page).toHaveURL(/\/m\/?$/)
    })

    test("observability session deep link maps to the mobile session chat", async ({page}) => {
        await page.goto("/w/ws1/p/pr1/observability?session=abc")
        // Pre-WP4 the target 404s inside /m; the URL mapping is the contract.
        await expect(page).toHaveURL(/\/m\/w\/ws1\/p\/pr1\/sessions\/abc$/)
    })

    test("auth stays on desktop (documented exception)", async ({page}) => {
        await page.goto("/auth")
        await expect(page).toHaveURL(/\/auth/)
        expect(page.url()).not.toContain("/m/")
    })

    test("?view=desktop sets the opt-out and pins the desktop site", async ({page, context}) => {
        await page.goto("/w?view=desktop")
        expect(page.url()).not.toContain("/m")
        const cookies = await context.cookies()
        expect(cookies.some((c) => c.name === "agenta-mobile-optout")).toBe(true)
        await page.goto("/w")
        expect(page.url()).not.toContain("/m")
    })
})

test.describe("mobile gate: reverse direction", () => {
    test.use({storageState: undefined})

    test("desktop UA on /m is sent to the desktop app", async ({page}) => {
        await page.goto("/m/")
        expect(new URL(page.url()).pathname.startsWith("/m")).toBe(false)
    })

    test("desktop UA on a mobile session URL lands on the session drawer link", async ({page}) => {
        await page.goto("/m/w/ws1/p/pr1/sessions/abc")
        await expect(page).toHaveURL(/\/w\/ws1\/p\/pr1\/observability\?session=abc/)
    })
})
```

- [ ] Run against a flag-on dev stack:

```bash
AGENTA_LICENSE=oss AGENTA_WEB_URL="http://localhost" AGENTA_MOBILE_GATE=true \
pnpm -C web/tests test:acceptance -- --grep "mobile gate" --workers=1
# EXPECT: 6 passed
```

- [ ] Run once WITHOUT `AGENTA_MOBILE_GATE` — expect `6 skipped` (proves CI safety).
- [ ] Commit:

```bash
git add web/oss/tests/playwright/acceptance/mobile-gate
git commit -m "test(frontend): add UA-emulation smoke for the mobile device gate"
```

---

## Task T7 — Docs: record WP5 state

- [ ] Update `docs/design/agenta-mobile/README.md`: add a WP5 section to "Execution state" (commits table as per the WP0/WP1 precedent), and move the flag-flip + NoMobilePageWrapper retirement into "Open items" with the wording from T8 below.
- [ ] Commit: `git add docs/design/agenta-mobile && git commit -m "docs(mobile): record WP5 gate execution state"`

---

## Task T8 — DEFERRED, FLAG-FLIP-COUPLED: retire `NoMobilePageWrapper`

> **Do NOT execute in this plan's run.** This commit ships only in the deployment window where `AGENTA_MOBILE_GATE` is being turned on (i.e. after WP2+WP4 give `/m` real content). Until then the banner remains the mobile UX for flag-off deployments. It is specified here so the flip is a two-line operational change plus one prepared commit.

- [ ] Verify references are still exactly two files: `grep -rln "NoMobilePageWrapper\|MOBILE_UNOPTIMIZED_APP_ROUTES" web/oss/src web/ee/src` → expect only the component dir + `web/oss/src/components/pages/_app/index.tsx`.
- [ ] In `web/oss/src/components/pages/_app/index.tsx`: delete the dynamic import block (currently `:38-43`) and the `<NoMobilePageWrapper />` JSX line (currently `:93`).
- [ ] Delete the directory `web/oss/src/components/Placeholders/NoMobilePageWrapper/`.
- [ ] Run: `cd web && pnpm --filter @agenta/oss types:check && pnpm build-oss` — clean.
- [ ] Commit: `refactor(frontend): retire NoMobilePageWrapper banner (gate replaces it)`

---

## Not in this plan

- **Flag flip-on rollout.** Turning `AGENTA_MOBILE_GATE=true` anywhere is an operational decision gated on WP2 (mobile auth) + WP4 (product pages) being live; procedure: set the env in the deployment's env file, recreate `web`/`web-mobile`, run the T6 smoke, then land T8.
- **`NoMobilePageWrapper` deletion timing** — prepared as T8, explicitly deferred and flag-flip-coupled.
- **Desktop-side "Open mobile version" affordance.** The mechanism ships (any link to `/m/?view=mobile` sets the opt-in); the desktop UI entry point is added later with a desktop component change — deliberately excluded to keep the desktop diff at zero components.
- **De-duplicating the mobile middleware copy** — swap to the `@agenta/shared/utils/mobileGate` import when WP2 wires `@agenta/*` deps (compose volumes + `Dockerfile.gh` manifests + turbo `dependsOn`).
- **gh-compose `web-mobile` service** (WP1 infra-tail plan) — gets `AGENTA_MOBILE_GATE` when created.
- **WP4-dependent deep-link targets** (mapped to safe roots for now):

| Desktop link | Ships as | Upgrade when |
|---|---|---|
| `/w/{ws}/p/{proj}/apps/{app}/playground?revisions=…` / `/agents` | `/m/w/{ws}/p/{proj}/sessions` (unfiltered) | WP4 adds an agent-filter query param + revision→agent resolution |
| `/auth` (mobile UA) | pass-through exception (desktop auth) | WP2 ships `/m/auth`; move `/auth` from `DESKTOP_EXCEPTIONS` into the map |
| mobile `/m/w/{ws}/p/{proj}/sessions/{id}` → desktop | `/w/{ws}/p/{proj}/observability?session={id}` (SessionDrawer) | playground adopts `?session=` from the URL (`adoptSessionAtomFamily` gains a URL caller) |
| `/w`, `/w/{ws}`, `/settings`, other context-free | `/m/` (placeholder today) | WP2 root context resolution replaces the placeholder |
