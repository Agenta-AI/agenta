import {useMemo, useSyncExternalStore} from "react"

/** `breakpoint-lg`: from here the sidebar is docked and the right pane docks beside the content. */
export const EXPANDED_WINDOW_QUERY = "(min-width: 1024px)"
/** Below `breakpoint-sm`: a compact window. */
export const COMPACT_WINDOW_QUERY = "(max-width: 639.98px)"

const subscribeTo = (query: string) => (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {}
    const list = window.matchMedia(query)
    list.addEventListener("change", onChange)
    return () => list.removeEventListener("change", onChange)
}

/**
 * A media query read during render: the real value on a client render, `false` while the page
 * hydrates (as on the server). Prefer it to `useMediaQuery` where a first wrong frame would show.
 */
export const useWindowMatch = (query: string): boolean =>
    useSyncExternalStore(
        useMemo(() => subscribeTo(query), [query]),
        () => (typeof window !== "undefined" && window.matchMedia?.(query).matches) || false,
        () => false,
    )

/** True on an expanded window (1024px and up). */
export const useIsExpandedWindow = (): boolean => useWindowMatch(EXPANDED_WINDOW_QUERY)

/** Touch: a coarse pointer (DESIGN.md). It is not a window size: a tablet is touch on a medium window. */
export const TOUCH_QUERY = "(pointer: coarse)"
/** A compact window on touch, where touch.css opens menus, selects and the combobox as bottom sheets. */
export const TOUCH_SHEET_QUERY = "(max-width: 639px) and (pointer: coarse)"

/** True on touch (a coarse pointer). */
export const useIsTouch = (): boolean => useWindowMatch(TOUCH_QUERY)
