/**
 * Client half of the classic-mode gate: the middleware reads only cookies, and none exists
 * before the first render, so the first visit redirects here and later ones in middleware.
 */

import {useEffect} from "react"

import {useAtomValue} from "jotai"

import {getEnv} from "../api/env"
import {advancedNavHiddenAtom} from "../state/classicMode"
import {activeUserIdAtom} from "../state/featureFlags"
import {
    CLASSIC_MODE_COOKIE,
    GATE_COOKIE_MAX_AGE,
    MOBILE_OPTOUT_COOKIE,
    desktopRouteFor,
    isDesktopOnlyLink,
    mobileRouteFor,
} from "../utils/mobileGate"

const readCookie = (name: string): string | undefined =>
    document.cookie
        .split("; ")
        .find((entry) => entry.startsWith(`${name}=`))
        ?.slice(name.length + 1)

const writeCookie = (name: string, value: string) => {
    document.cookie = `${name}=${value}; path=/; max-age=${GATE_COOKIE_MAX_AGE}; samesite=lax`
}

const clearCookie = (name: string) => {
    document.cookie = `${name}=; path=/; max-age=0; samesite=lax`
}

/**
 * The same kill switch the middleware reads, on the client half.
 *
 * `AGENTA_CLASSIC_MODE_GATE` is a bare (non-`NEXT_PUBLIC_`) variable resolved server-side, so the
 * browser cannot see it; `entrypoint.sh` mirrors it into `__env.js` under this name. Without the
 * mirror, turning the flag off stopped the middleware and left the client redirecting anyway,
 * which is half a kill switch and worse than none.
 */
const classicGateEnabled = () => getEnv("NEXT_PUBLIC_AGENTA_CLASSIC_MODE_GATE") !== "false"

/**
 * Publish the preference now, rather than waiting for the sync effect below.
 *
 * A switch that both writes the preference and navigates cannot wait a frame for an effect: the
 * document unloads first, and the user arrives at a gate still reading their old answer.
 */
export const writeClassicModeCookie = (classicModeEnabled: boolean) => {
    if (typeof document === "undefined") return
    writeCookie(CLASSIC_MODE_COOKIE, classicModeEnabled ? "1" : "0")
}

/**
 * Publish the signed-in user's Classic mode preference as a cookie the middleware can read.
 *
 * Written only once a user is known — the preference is scoped by user id, and a cookie written
 * under nobody would decide which app the NEXT person on this browser gets. Cleared on sign-out
 * for the same reason.
 */
export const useClassicModeCookieSync = () => {
    const userId = useAtomValue(activeUserIdAtom)
    const advancedNavHidden = useAtomValue(advancedNavHiddenAtom)

    useEffect(() => {
        if (typeof document === "undefined") return
        if (!userId) {
            clearCookie(CLASSIC_MODE_COOKIE)
            return
        }
        writeCookie(CLASSIC_MODE_COOKIE, advancedNavHidden ? "0" : "1")
    }, [userId, advancedNavHidden])
}

/**
 * Desktop-only: send a Classic-mode-off user to `/m`, for the pages `/m` has.
 *
 * Only covers the FIRST visit — once {@link useClassicModeCookieSync} has published the
 * preference, the middleware does this before anything renders. Pass `enabled: false` while a
 * sign-in is still in flight; see the `/auth` note below for why that matters.
 *
 * `location.replace`, not the router: `/m` is a different Next app behind the same origin, so
 * this is a document navigation whichever way it is spelled — and replace keeps the desktop URL
 * out of history, where Back would bounce off it.
 */
export const useClassicModeRedirect = (enabled = true) => {
    const userId = useAtomValue(activeUserIdAtom)
    const advancedNavHidden = useAtomValue(advancedNavHiddenAtom)

    useEffect(() => {
        if (!enabled || typeof window === "undefined") return
        if (!classicGateEnabled()) return
        // No user means no preference to read — the atom reports the default, not a choice.
        if (!userId || !advancedNavHidden) return

        const {pathname, search} = window.location
        // Never from `/auth`, even though the gate maps it: post-auth sets the user id and the
        // signup-era default and THEN routes onward, so a user is briefly known while still
        // standing on the sign-in page. Redirecting into that window races the router and, for a
        // new EE user, skips the post-signup survey outright.
        if (/^\/auth(\/|$)/.test(pathname)) return
        if (isDesktopOnlyLink(pathname, search)) return
        if (readCookie(MOBILE_OPTOUT_COOKIE)) return

        const target = mobileRouteFor(pathname, search)
        if (target) window.location.replace(target)
    }, [enabled, userId, advancedNavHidden])
}

/**
 * `/m`-only: the desktop page matching wherever the user is standing, for the Classic mode
 * switch to send them to. Falls back to the desktop root.
 */
export const desktopEscapeHref = (): string => {
    if (typeof window === "undefined") return "/w"
    // The address bar carries `/m`; the route map works in basePath-less paths.
    const {pathname, search} = window.location
    const stripped = pathname === "/m" ? "/" : pathname.replace(/^\/m(?=\/)/, "")
    return desktopRouteFor(stripped, search) ?? "/w"
}
