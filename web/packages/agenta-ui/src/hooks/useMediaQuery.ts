import {useEffect, useState} from "react"

/**
 * Replaces antd's `Grid.useBreakpoint()` for the one thing the table asked it: is the viewport
 * narrow. antd's `lg` is 992px, so `!screens.lg` is `max-width: 991.98px`.
 *
 * Starts false and reads after mount, the same way `useThemeMode` does. The value is
 * client-only, so hydrating from it would mismatch the server render, and a wide-screen first
 * paint is the same assumption antd made.
 */
export const useMediaQuery = (query: string): boolean => {
    const [matches, setMatches] = useState(false)

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return
        const list = window.matchMedia(query)
        setMatches(list.matches)
        const sync = (event: MediaQueryListEvent) => setMatches(event.matches)
        list.addEventListener("change", sync)
        return () => list.removeEventListener("change", sync)
    }, [query])

    return matches
}

/** antd's `lg` breakpoint, the only one the table used. */
export const NARROW_SCREEN_QUERY = "(max-width: 991.98px)"

export const useIsNarrowScreen = (): boolean => useMediaQuery(NARROW_SCREEN_QUERY)
