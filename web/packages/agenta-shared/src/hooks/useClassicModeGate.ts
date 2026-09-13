/**
 * Client half of the classic-mode gate: the middleware reads only cookies, and none exists
 * before the first render, so the first visit redirects here and later ones in middleware.
 */

import {useEffect} from "react"

import {useAtomValue} from "jotai"

import {getEnv} from "../api/env"
import {
    advancedNavHiddenAtom,
    readSettledAdvancedNavHidden,
    readSettledClassicModeCookie,
} from "../state/classicMode"
import {activeUserIdAtom} from "../state/featureFlags"
import {userAtom} from "../state/user"
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
 * The settled preference, or `null` while it is still unknown.
 *
 * The three atoms are subscribed for their re-renders, not their values: they fire when the user
 * changes, when the profile lands, and when the switch is flipped. The VALUE comes from storage,
 * which answers exactly. Cheap enough to read per render, and it returns a primitive, so the
 * effects below still only re-run when the answer actually changes.
 */
const useSettledAdvancedNavHidden = (): boolean | null => {
    useAtomValue(activeUserIdAtom)
    useAtomValue(advancedNavHiddenAtom)
    const user = useAtomValue(userAtom)

    return readSettledAdvancedNavHidden(user)
}

/**
 * Publish the signed-in user's Classic mode preference as a cookie the middleware can read.
 *
 * Written only once a user is known — the preference is scoped by user id, and a cookie written
 * under nobody would decide which app the NEXT person on this browser gets. Cleared on sign-out
 * for the same reason, and cleared again when the answer is a bare default rather than a choice.
 * `readSettledClassicModeCookie` draws that line and explains why the gates need it drawn.
 */
export const useClassicModeCookieSync = () => {
    useAtomValue(activeUserIdAtom)
    useAtomValue(advancedNavHiddenAtom)
    const user = useAtomValue(userAtom)
    // A primitive, so the effect still runs only when the answer actually changes.
    const value = readSettledClassicModeCookie(user)

    useEffect(() => {
        if (typeof document === "undefined") return
        // `undefined` is "nothing new to say" — leave whatever is there. `null` is a real
        // answer: this browser has no preference to publish, so the gates fall back to the
        // device heuristic.
        if (value === undefined) return
        if (value === null) {
            clearCookie(CLASSIC_MODE_COOKIE)
            return
        }
        writeCookie(CLASSIC_MODE_COOKIE, value)
    }, [value])
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
 *
 * DELIBERATELY ONE-WAY. `/m` must not grow a mirror of this hook. The two apps are separate JS
 * contexts sharing only storage, so each would redirect on a value the other cannot see, with
 * nothing to arbitrate and nothing to break the cycle: any disagreement becomes an endless
 * `/w` ↔ `/m` bounce instead of a stop. Leaving `/m` is the proxy's job — one cookie, and the
 * desktop gate yields to it through `wantsClassic`.
 */
export const useClassicModeRedirect = (enabled = true) => {
    const userId = useAtomValue(activeUserIdAtom)
    const advancedNavHidden = useSettledAdvancedNavHidden()

    useEffect(() => {
        if (!enabled || typeof window === "undefined") return
        if (!classicGateEnabled()) return
        // No user means no preference to read, and `null` means it is not known yet. Redirecting
        // on either is a navigation this effect cannot take back.
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
        if (!target) return
        // Publish before navigating, exactly as the Classic mode switch does. Relying on the
        // sync effect above having already run makes this correct only by hook order; if the
        // cookie is missing when `/m` is asked for, its proxy sees no preference, falls through
        // to the device check, and bounces a desktop UA straight back here. That is a loop.
        writeClassicModeCookie(false)
        window.location.replace(target)
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
