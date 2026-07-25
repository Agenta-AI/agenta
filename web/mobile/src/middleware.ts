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
        const pathname = raw === "/m" ? "/" : raw.startsWith("/m/") ? raw.slice("/m".length) : raw
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
