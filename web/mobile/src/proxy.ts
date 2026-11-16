import {
    GATE_COOKIE_MAX_AGE,
    decideMobileGate,
    mapDesktopToMobile,
    mobileRouteFor,
} from "@agenta/shared/utils/mobileGate"
import {NextRequest, NextResponse} from "next/server"

import {GATE_PATH} from "@/lib/mobileGateScript"

/**
 * Reverse direction of the gate: a user who turned Classic mode on is returned from /m to the
 * desktop equivalent. The device plays no part here, so a desktop browser may open /m.
 * NextRequest adapter only; the decision lives in @agenta/shared/utils/mobileGate.
 */
export function proxy(request: NextRequest) {
    // At runtime Next strips basePath ("/m") from nextUrl before the handler;
    // unit tests construct NextRequest directly, so normalize.
    const raw = request.nextUrl.pathname
    const pathname = raw === "/m" ? "/" : raw.startsWith("/m/") ? raw.slice("/m".length) : raw

    // `next.config.ts` redirects every desktop root path here, unchanged, with its query.
    if (/^\/legacy(\/|$)/.test(pathname)) return legacyRedirect(request, pathname)

    // `mobileGateScript` sends in-app document loads here, naming the page in `to`.
    const viaGate = pathname === GATE_PATH
    let page = {pathname, search: request.nextUrl.search}
    if (viaGate) {
        const to = request.nextUrl.searchParams.get("to") ?? "/"
        // Same-origin paths only: anything else would make this an open redirect.
        const url = new URL(to.startsWith("/") && !to.startsWith("//") ? to : "/", request.url)
        page = {pathname: url.pathname, search: url.search}
    }

    const decision = decideMobileGate({
        pathname: page.pathname,
        search: page.search,
        method: request.method,
        header: (name) => request.headers.get(name),
        cookie: (name) => request.cookies.get(name)?.value,
    })

    if (decision.kind === "redirect") {
        return NextResponse.redirect(new URL(decision.location, request.url), 307)
    }
    if (decision.kind === "set-cookie-redirect") {
        // The decision names a basePath-less path; this app owns the /m prefix.
        const target = decision.location === "/" ? "/m/" : `/m${decision.location}`
        const response = NextResponse.redirect(new URL(target, request.url), 307)
        response.cookies.set(decision.cookie, "1", {
            path: "/",
            maxAge: GATE_COOKIE_MAX_AGE,
            sameSite: "lax",
        })
        response.cookies.set(decision.clearCookie, "", {path: "/", maxAge: 0})
        return response
    }
    if (viaGate) {
        return NextResponse.redirect(new URL(`/m${page.pathname}${page.search}`, request.url), 307)
    }
    return NextResponse.next()
}

/** Desktop links open in every browser, so the developer views count as on (`/m` gates them). */
function legacyRedirect(request: NextRequest, pathname: string) {
    const desktopPath = pathname.slice("/legacy".length) || "/"
    const {search} = request.nextUrl
    const options = {developerViews: true}
    if (!mobileRouteFor(desktopPath, search, options)) {
        // The path only: a query can carry tokens and emails.
        console.warn(`[legacy] no /m page for ${desktopPath}, sent to the /m root`)
    }
    return NextResponse.redirect(
        new URL(mapDesktopToMobile(desktopPath, search, options), request.url),
        307,
    )
}

export const config = {
    // Entry routes only. With middleware on a route, the Pages Router asks the server (a
    // `_next/data` request) before every client navigation to it, so in-app routes are gated by
    // `mobileGateScript` instead. The explicit "/" entry is required: with basePath, the bare root
    // (`/m`, no trailing slash) does not match a `/(...)` pattern.
    matcher: ["/", "/auth/:path*", "/invite", "/__gate", "/legacy/:path*"],
}
