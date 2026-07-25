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
