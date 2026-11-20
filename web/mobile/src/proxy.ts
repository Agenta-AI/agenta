import {
    GATE_COOKIE_MAX_AGE,
    decideMobileGate,
    mapDesktopToMobile,
    mobileRouteFor,
} from "@agenta/shared/utils/mobileGate"
import {NextRequest, NextResponse} from "next/server"

/**
 * Answers legacy desktop URLs and the desktop's `?view=mobile` link. It never sends anyone to
 * the desktop. NextRequest adapter only; the decisions live in @agenta/shared/utils/mobileGate.
 */
export function proxy(request: NextRequest) {
    // At runtime Next strips basePath ("/m") from nextUrl before the handler;
    // unit tests construct NextRequest directly, so normalize.
    const raw = request.nextUrl.pathname
    const pathname = raw === "/m" ? "/" : raw.startsWith("/m/") ? raw.slice("/m".length) : raw

    // `next.config.ts` redirects every desktop root path here, unchanged, with its query.
    if (/^\/legacy(\/|$)/.test(pathname)) return legacyRedirect(request, pathname)

    const decision = decideMobileGate({
        pathname,
        search: request.nextUrl.search,
        method: request.method,
        header: (name) => request.headers.get(name),
        cookie: (name) => request.cookies.get(name)?.value,
    })
    if (decision.kind !== "set-cookie-redirect") return NextResponse.next()

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
    // Entry routes only: with a proxy on a route, every client navigation to it costs a
    // `_next/data` request. With basePath, the bare root (`/m`) needs its own "/" entry.
    matcher: ["/", "/auth/:path*", "/invite", "/legacy/:path*"],
}
