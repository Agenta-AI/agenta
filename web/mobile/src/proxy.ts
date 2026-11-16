import {mapDesktopToMobile, mobileRouteFor} from "@agenta/shared/utils/mobileGate"
import {NextRequest, NextResponse} from "next/server"

/**
 * Answers root URLs that `next.config.ts` sends to `/m/legacy`. NextRequest adapter only; the
 * map lives in @agenta/shared/utils/mobileGate.
 */
export function proxy(request: NextRequest) {
    // At runtime Next strips basePath ("/m") from nextUrl before the handler;
    // unit tests construct NextRequest directly, so normalize.
    const raw = request.nextUrl.pathname
    const pathname = raw === "/m" ? "/" : raw.startsWith("/m/") ? raw.slice("/m".length) : raw

    // `next.config.ts` redirects every other root path here, unchanged, with its query.
    if (/^\/legacy(\/|$)/.test(pathname)) return legacyRedirect(request, pathname)
    return NextResponse.next()
}

/** Root links open in every browser, so the developer views count as on (`/m` gates them). */
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
    // With a proxy on a route, every client navigation to it costs a `_next/data` request.
    matcher: ["/legacy/:path*"],
}
