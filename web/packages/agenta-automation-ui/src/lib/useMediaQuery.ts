import {useCallback, useSyncExternalStore} from "react"

/**
 * A media query as React state — for the cases where a breakpoint has to pick a TREE, not just a
 * `display` value. Tailwind's responsive classes are the default answer; reach for this only when
 * rendering both branches would mount both (duplicate queries, duplicate streams).
 *
 * SSR: the app is on the Pages Router, so the first paint happens on the server where there is no
 * `matchMedia`. `useSyncExternalStore`'s third argument is the server snapshot — React renders and
 * HYDRATES with it, then reads the client snapshot and re-renders if it differs, so a mismatch
 * corrects itself on mount instead of tripping a hydration error.
 */
export const useMediaQuery = (query: string, serverDefault = false) => {
    const subscribe = useCallback(
        (onStoreChange: () => void) => {
            const mql = window.matchMedia(query)
            mql.addEventListener("change", onStoreChange)
            return () => mql.removeEventListener("change", onStoreChange)
        },
        [query],
    )
    // Returns a boolean, so a fresh `matchMedia` per read is still a stable snapshot.
    const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
    const getServerSnapshot = useCallback(() => serverDefault, [serverDefault])

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
