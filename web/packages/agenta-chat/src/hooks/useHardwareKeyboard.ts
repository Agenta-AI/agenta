import {useSyncExternalStore} from "react"

/**
 * Touch-only devices, as the platform describes them: no hover, and a coarse pointer.
 *
 * Deliberately not a viewport width. A narrow desktop window still has a keyboard, and a large
 * tablet still does not, so width answers a different question than the one being asked. Both
 * conditions together are the standard test — `pointer: coarse` alone also matches a touchscreen
 * laptop, which does have a keyboard and should keep its shortcuts.
 */
const TOUCH_ONLY_QUERY = "(hover: none) and (pointer: coarse)"

const subscribe = (onChange: () => void): (() => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {}
    const list = window.matchMedia(TOUCH_ONLY_QUERY)
    // Safari below 14 has no addEventListener on MediaQueryList.
    if (typeof list.addEventListener === "function") {
        list.addEventListener("change", onChange)
        return () => list.removeEventListener("change", onChange)
    }
    list.addListener(onChange)
    return () => list.removeListener(onChange)
}

const isTouchOnly = (): boolean => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
    return window.matchMedia(TOUCH_ONLY_QUERY).matches
}

/**
 * Can the user press the shortcuts we advertise?
 *
 * SSR and any browser without `matchMedia` answer TRUE, so the server render matches today's
 * output and a device we cannot classify keeps the hints rather than losing them.
 */
export const useHardwareKeyboard = (): boolean =>
    useSyncExternalStore(
        subscribe,
        () => !isTouchOnly(),
        () => true,
    )
