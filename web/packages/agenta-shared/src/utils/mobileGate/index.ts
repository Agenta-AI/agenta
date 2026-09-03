/**
 * The gate that decides which app a request gets — pure decision core.
 *
 * Two independent reasons to send someone to `/m`, each with its own flag:
 * - the DEVICE gate (agenta-mobile WP5): a mobile device on a desktop route.
 * - the CLASSIC-MODE gate: a user whose "Classic mode" preference is off, whatever
 *   they are browsing on. The preference lives in `state/classicMode`; it reaches
 *   this request-time code as a cookie the apps mirror (see CLASSIC_MODE_COOKIE).
 *
 * Framework-free: the Next middlewares (desktop forward gate in web/oss +
 * web/ee, mobile reverse gate in web/mobile) adapt NextRequest into a
 * `GateInput` and apply the returned `GateDecision`. Keeping the logic pure
 * means detection, the route map, cookie semantics, and the documented
 * exceptions are all unit-tested here without NextRequest mocks.
 */

import {SESSION_QUERY_PARAM} from "../sessionParam"

export const MOBILE_OPTOUT_COOKIE = "agenta-mobile-optout"
export const MOBILE_OPTIN_COOKIE = "agenta-mobile-optin"
/**
 * Set by the mobile app right before it sends the browser to an OIDC provider,
 * and cleared by /m/auth/callback. Providers only ever redirect to the ONE
 * registered URI (the desktop `/auth/callback/<providerId>`), so this cookie is
 * how the desktop gate knows a landing callback belongs to the mobile app and
 * must be handed to /m — where the OAuth state lives in the same-origin
 * sessionStorage. Short-lived (see MOBILE_AUTH_CALLBACK_MAX_AGE).
 */
export const MOBILE_AUTH_CALLBACK_COOKIE = "agenta-mobile-auth-callback"
/** 10 minutes — matches SuperTokens' own OAuth state expiry. */
export const MOBILE_AUTH_CALLBACK_MAX_AGE = 60 * 10
/**
 * The user's "Classic mode" preference, mirrored from localStorage by both apps so it is
 * readable at request time. `"1"` = classic on (desktop), `"0"` = classic off (`/m`).
 *
 * Absent means UNKNOWN, never "off": the preference is per-browser, so a user who has not
 * loaded either app since this shipped, or who cleared their site data, has no cookie — and
 * bouncing them on a guess would move people who never chose the simplified experience.
 */
export const CLASSIC_MODE_COOKIE = "agenta-classic-mode"

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
    /**
     * AGENTA_MOBILE_GATE — the DEVICE gate, resolved by the adapter at request time with
     * `resolveGateEnabled`. DEFAULT ON: a deployment opts out with `AGENTA_MOBILE_GATE=false`.
     */
    gateEnabled: boolean
    /**
     * AGENTA_MOBILE_REVERSE_GATE, mobile-app only. `false` keeps the forward gate (mobile
     * devices → /m) while letting anything reach /m: tablets and desktop-UA browsers report
     * as non-mobile, so the bounce blocks deliberate visits. Defaults to on.
     */
    reverseGateEnabled?: boolean
    /**
     * AGENTA_CLASSIC_MODE_GATE — the CLASSIC-MODE gate, independent of `gateEnabled` so a bad
     * `/m` surface can be switched off without also disabling device detection. Defaults to on.
     */
    classicGateEnabled?: boolean
}

/**
 * Env → flag, for both gates. DEFAULT ON: only the exact string "false" turns a
 * gate off, so an unset, empty, or misspelled value keeps the mobile app
 * reachable. Both gates ship on so that no deployment (cloud, self-hosted
 * compose, Railway, local dev) needs an env key to give phones /m; the keys are
 * an opt-OUT.
 *
 * The adapters read process.env INSIDE the request handler, never at module
 * scope: on the self-hosted standalone Node server, non-NEXT_PUBLIC env is
 * resolved at runtime, so flipping the key and recreating the container is
 * enough — no rebuild.
 */
export function resolveGateEnabled(raw: string | undefined | null): boolean {
    return raw !== "false"
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
 * exceptions). /auth now maps to the mobile sign-in (→ /m/auth), EXCEPT
 * /auth/callback: an OAuth/SSO redirect landing must never be bounced mid-flow,
 * because the redirect URI is fixed at the provider. When the mobile app started
 * the flow (MOBILE_AUTH_CALLBACK_COOKIE) the landing is forwarded to the mirror
 * page under /m instead — see decideDesktopGate. /post-signup and
 * /workspaces/accept are permanently desktop-only.
 */
const AUTH_CALLBACK_RE = /^\/auth\/callback(\/|$)/

const AUTH_RE = /^\/auth(\/|$)/

/**
 * An `/auth` link carrying a one-time `token` (SuperTokens password reset, invite acceptance —
 * `web/oss/src/pages/auth/[[...path]].tsx` reads `router.query.token`) completes on desktop.
 *
 * Redirecting it would drop the token twice over: `mapDesktopToMobile` returns a bare `/m/auth`,
 * and the mobile app has no screen that consumes one. Same reasoning as the OAuth callback
 * exception — a single-use credential must not be bounced.
 */
export function isTokenBearingAuthLink(pathname: string, search: string): boolean {
    if (!AUTH_RE.test(pathname)) return false
    return Boolean(new URLSearchParams(search).get("token"))
}

/**
 * An `/auth` link carrying `auth_error` completes on desktop, for the same reason as a token: the
 * param IS the payload. `web/oss/src/lib/api/assets/axiosConfig.ts` redirects a 403 here so the
 * user can finish required SSO or social re-authentication, and the desktop auth page reads it.
 * `mapDesktopToMobile` returns a bare `/m/auth`, so redirecting would drop the reason and leave
 * the user on a sign-in screen that cannot explain why it appeared.
 */
export function isPolicyAuthLink(pathname: string, search: string): boolean {
    if (!AUTH_RE.test(pathname)) return false
    return Boolean(new URLSearchParams(search).get("auth_error"))
}

const DESKTOP_EXCEPTIONS = [AUTH_CALLBACK_RE, /^\/post-signup(\/|$)/, /^\/workspaces\/accept(\/|$)/]

/**
 * Routes that finish where they landed, whatever any gate would prefer: an OAuth callback, the
 * post-signup survey, an invite acceptance, and any `/auth` link carrying a one-time token or a
 * policy error. One list, so the middleware and the client-side redirect cannot disagree.
 */
export function isDesktopOnlyLink(pathname: string, search: string): boolean {
    if (DESKTOP_EXCEPTIONS.some((re) => re.test(pathname))) return true
    return isTokenBearingAuthLink(pathname, search) || isPolicyAuthLink(pathname, search)
}

const PROJECT_PATH_RE = /^\/w\/([^/]+)\/p\/([^/]+)(?:\/(.*))?$/

/**
 * Desktop sub-paths under `/apps` that are NOT an agent id — they must not be read as one.
 * `/apps/archived` is the archived list, `/apps/agent-templates` the template gallery.
 */
const APPS_RESERVED = new Set(["archived", "agent-templates"])

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "")

/**
 * Desktop URL → the `/m` route that shows the same thing, or `null` when `/m` has no such
 * screen (evaluations, test sets, prompts, evaluators, annotations, the registry).
 *
 * Null is a real answer, not a failure: the classic-mode gate leaves those on the desktop app
 * rather than dumping the user somewhere unrelated. The device gate treats it as "/m root",
 * because a phone cannot use those pages either way — see {@link mapDesktopToMobile}.
 */
export function mobileRouteFor(pathname: string, search: string): string | null {
    // Mobile sign-in: /auth/callback never reaches here (handled as an exception).
    if (/^\/auth(\/|$)/.test(pathname)) return "/m/auth"

    // The mobile root resolves last-used workspace/project (same resolution as post-login).
    if (/^\/w(\/[^/]+(\/p\/?)?)?\/?$/.test(pathname)) return "/m/"

    const match = pathname.match(PROJECT_PATH_RE)
    if (!match) return null

    const [, ws, proj, tail] = match
    const base = `/m/w/${ws}/p/${proj}`
    const rest = trimSlashes(tail ?? "")
    const [head, first, second] = rest.split("/")
    const params = new URLSearchParams(search)

    // The project root and /apps are both the home screen.
    if (!head || head === "apps") {
        if (head !== "apps" || !first) return `${base}/apps`

        if (first === "agent-templates") {
            return second ? `${base}/templates/${second}` : `${base}/templates`
        }
        if (APPS_RESERVED.has(first)) return null

        // `/m` has no playground route: a session's page IS the playground, and `?agent=`
        // names the agent for a session whose turns cannot yet.
        const sessionId = params.get(SESSION_QUERY_PARAM)
        if (second === "playground" && sessionId) {
            return `${base}/sessions/${encodeURIComponent(sessionId)}?agent=${first}`
        }
        // Every other app-scoped desktop page (playground, overview, sessions, deployments…)
        // collapses to the agent's own screen — the only agent surface `/m` has.
        return `${base}/agents/${first}`
    }

    if (head === "agents") {
        if (!first) return `${base}/agents`
        return first === "archived" ? null : `${base}/agents/${first}`
    }

    if (head === "sessions") {
        return first ? `${base}/sessions/${encodeURIComponent(first)}` : `${base}/sessions`
    }

    if (head === "observability" && !first) {
        // ?session={id} is the observability drawer's own param (web/oss/src/state/url/session.ts),
        // distinct from SESSION_QUERY_PARAM — land in that session's chat.
        const drawerSession = params.get("session")
        return drawerSession
            ? `${base}/sessions/${encodeURIComponent(drawerSession)}`
            : `${base}/observability`
    }

    if (head === "settings" && !first) return `${base}/settings`

    return null
}

/**
 * Desktop URL → mobile equivalent for the DEVICE gate, which is total: a phone gets `/m` even
 * for a page `/m` does not mirror, because the desktop page is unusable there regardless.
 */
export function mapDesktopToMobile(pathname: string, search: string): string {
    return mobileRouteFor(pathname, search) ?? "/m/"
}

/**
 * Mobile URL (basePath already stripped) → the desktop route showing the same thing, or `null`
 * when nothing better than the desktop root applies.
 *
 * The inverse of {@link mobileRouteFor}, and the destination when a user turns Classic mode back
 * on from inside `/m` — landing them on the desktop equivalent of the page they were reading,
 * rather than at the top of the app.
 */
export function desktopRouteFor(pathname: string, search = ""): string | null {
    if (/^\/auth(\/|$)/.test(pathname)) return "/auth"

    const match = pathname.match(PROJECT_PATH_RE)
    if (!match) return null

    const [, ws, proj, tail] = match
    const base = `/w/${ws}/p/${proj}`
    const rest = trimSlashes(tail ?? "")
    const [head, first] = rest.split("/")

    if (!head || head === "apps") return first ? null : `${base}/apps`

    if (head === "agents") return first ? `${base}/apps/${first}/playground` : `${base}/agents`

    if (head === "templates") {
        return first ? `${base}/apps/agent-templates/${first}` : `${base}/apps/agent-templates`
    }

    if (head === "sessions") {
        if (!first) return `${base}/sessions`
        // A session opens as a tab on its agent's playground; `?agent=` is the only place the
        // mobile URL names that agent. Without it, the observability drawer still shows the
        // session — it needs no agent to open one.
        const agentId = new URLSearchParams(search).get("agent")
        return agentId
            ? `${base}/apps/${encodeURIComponent(agentId)}/playground?${SESSION_QUERY_PARAM}=${encodeURIComponent(first)}`
            : `${base}/observability?session=${encodeURIComponent(first)}`
    }

    if ((head === "observability" || head === "settings") && !first) return `${base}/${head}`

    return null
}

/** The same map for the reverse DEVICE gate, which must always name somewhere to go. */
export function mapMobileToDesktop(pathname: string, search = ""): string {
    return desktopRouteFor(pathname, search) ?? "/w"
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
        // `?view=desktop` outranks everything below, including the callback handback: it is the
        // user saying "keep me here", and it must still win now that the callback check runs
        // before the flag.
        const wantsDesktop = new URLSearchParams(input.search).get(VIEW_PARAM) === "desktop"

        // BEFORE the flag: a provider redirect the MOBILE app started has to reach /m whether or
        // not the device gate is on. The cookie is an explicit intent set by /m moments earlier,
        // not a device heuristic, and the OAuth state lives in /m's same-origin sessionStorage.
        // A deployment that opts out with AGENTA_MOBILE_GATE=false still runs /m, so gating this
        // strands every mobile SSO sign-in on the desktop route, where the state it needs does
        // not exist.
        if (
            !wantsDesktop &&
            isDocumentNavigation(input) &&
            AUTH_CALLBACK_RE.test(input.pathname) &&
            input.cookie(MOBILE_AUTH_CALLBACK_COOKIE)
        ) {
            return {kind: "redirect", location: `/m${input.pathname}${input.search}`}
        }

        const classicGateEnabled = input.classicGateEnabled !== false
        if (!input.gateEnabled && !classicGateEnabled) return {kind: "pass"}
        if (!isDocumentNavigation(input)) return {kind: "pass"}

        // Escape hatch: "View desktop site" links carry ?view=desktop. It opts out of BOTH
        // reasons to bounce — a user asking to stay here does not care which one sent them.
        if (wantsDesktop) {
            return {
                kind: "set-cookie-redirect",
                cookie: MOBILE_OPTOUT_COOKIE,
                clearCookie: MOBILE_OPTIN_COOKIE,
                location: stripViewParam(input.pathname, input.search),
            }
        }

        // The mobile-started callback is handled above, before the flag.
        if (isDesktopOnlyLink(input.pathname, input.search)) return {kind: "pass"}
        if (input.cookie(MOBILE_OPTOUT_COOKIE)) return {kind: "pass"}

        // Device: a phone gets /m for anything, mapped or not.
        if (input.gateEnabled && isMobileDevice(input.header)) {
            return {kind: "redirect", location: mapDesktopToMobile(input.pathname, input.search)}
        }

        // Preference: Classic mode off means live in /m — but only for pages /m actually has.
        if (classicGateEnabled && input.cookie(CLASSIC_MODE_COOKIE) === "0") {
            const location = mobileRouteFor(input.pathname, input.search)
            if (location) return {kind: "redirect", location}
        }

        return {kind: "pass"}
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

        // An OAuth landing completes wherever it lands — bouncing it drops the
        // one-time code and strands the flow.
        if (AUTH_CALLBACK_RE.test(input.pathname)) return {kind: "pass"}
        if (input.cookie(MOBILE_OPTIN_COOKIE)) return {kind: "pass"}
        // Classic mode off means /m is where this user belongs, so the device heuristic must not
        // bounce them out of it. Without this the two gates ping-pong forever on a desktop UA:
        // the desktop gate sends them here for the preference, this one sends them back for the
        // device, and the cookie that started it never changes.
        if (input.classicGateEnabled !== false && input.cookie(CLASSIC_MODE_COOKIE) === "0") {
            return {kind: "pass"}
        }
        // Checked after ?view=mobile so the opt-in cookie is still set if the bounce is re-enabled.
        if (input.reverseGateEnabled === false) return {kind: "pass"}
        if (isMobileDevice(input.header)) return {kind: "pass"}

        return {kind: "redirect", location: mapMobileToDesktop(input.pathname, input.search)}
    } catch {
        return {kind: "pass"}
    }
}
