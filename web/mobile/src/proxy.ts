import {
    GATE_COOKIE_MAX_AGE,
    decideMobileGate,
    resolveGateEnabled,
} from "@agenta/shared/utils/mobileGate"
import {NextRequest, NextResponse} from "next/server"

/**
 * Mobile device gate, reverse direction (agenta-mobile WP5): desktop devices
 * navigating /m are redirected to the desktop equivalent. DEFAULT ON — a
 * deployment opts out with AGENTA_MOBILE_GATE=false (read at
 * request time; runtime-flippable on the standalone Node server).
 *
 * No reverse classic-mode gate on purpose: leaving /m is an explicit act (Settings › Preferences).
 * NextRequest adapter only; the decision lives in @agenta/shared/utils/mobileGate.
 */
export function proxy(request: NextRequest) {
    // At runtime Next strips basePath ("/m") from nextUrl before the handler;
    // unit tests construct NextRequest directly, so normalize.
    const raw = request.nextUrl.pathname
    const pathname = raw === "/m" ? "/" : raw.startsWith("/m/") ? raw.slice("/m".length) : raw

    const decision = decideMobileGate({
        pathname,
        search: request.nextUrl.search,
        method: request.method,
        header: (name) => request.headers.get(name),
        cookie: (name) => request.cookies.get(name)?.value,
        gateEnabled: resolveGateEnabled(process.env.AGENTA_MOBILE_GATE),
        reverseGateEnabled: resolveGateEnabled(process.env.AGENTA_MOBILE_REVERSE_GATE),
        // Read here too: a Classic-mode-off user belongs in /m, so this gate must not bounce
        // them back to the desktop that just sent them.
        classicGateEnabled: process.env.AGENTA_CLASSIC_MODE_GATE !== "false",
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
    return NextResponse.next()
}

export const config = {
    // The explicit "/" entry is required: with basePath, the bare root
    // (`/m`, no trailing slash) does not match the `/(...)` capture pattern,
    // leaving the landing page ungated without it.
    matcher: ["/", "/((?!_next|__env\\.js|.*\\..*).*)"],
}
