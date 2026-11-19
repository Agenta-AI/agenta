import {NextRequest, NextResponse} from "next/server"

import {legacyTarget} from "./lib/legacyRoutes"

/** Answers root URLs that `next.config.ts` forwards to `/m/legacy/*`. */
export function proxy(request: NextRequest) {
    // Next strips basePath at runtime; unit tests build NextRequest without it.
    const raw = request.nextUrl.pathname
    const pathname = raw.startsWith("/m/") ? raw.slice("/m".length) : raw
    const path = pathname.slice("/legacy".length) || "/"
    const {target, matched} = legacyTarget(path, request.nextUrl.search)
    // The path only: a query can carry tokens and emails.
    if (!matched && path.startsWith("/w/")) console.warn(`[legacy] no /m page for ${path}`)
    return NextResponse.redirect(new URL(target, request.url), 307)
}

export const config = {
    // With a proxy on a route, every client navigation to it costs a `_next/data` request.
    matcher: ["/legacy/:path*"],
}
