import {GATE_COOKIE_MAX_AGE, decideDesktopGate} from "@agenta/shared/utils/mobileGate"
import {NextRequest, NextResponse} from "next/server"

/**
 * Forward gate: desktop routes are redirected into the /m app, for two reasons: the device
 * heuristic and the Classic mode preference.
 *
 * There is no switch: every deployment runs /m. Behind Traefik this middleware never sees /m traffic
 * (PathPrefix(`/m`) routes to the mobile app); the matcher still excludes /m
 * for direct-port dev runs.
 *
 * TWIN NOTE: web/oss/src/middleware.ts is a byte-identical copy (EE is a
 * separate Next app and the matcher config must be static per file).
 */
export function middleware(request: NextRequest) {
    const decision = decideDesktopGate({
        pathname: request.nextUrl.pathname,
        search: request.nextUrl.search,
        method: request.method,
        header: (name) => request.headers.get(name),
        cookie: (name) => request.cookies.get(name)?.value,
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
