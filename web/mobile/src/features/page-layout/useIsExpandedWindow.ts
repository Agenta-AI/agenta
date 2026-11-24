import {useSyncExternalStore} from "react"

/** `breakpoint-lg`: from here the sidebar is docked and the page has no bar across the top. */
const EXPANDED_QUERY = "(min-width: 1024px)"

const expandedList = () =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(EXPANDED_QUERY) : null

const subscribe = (onChange: () => void) => {
    const list = expandedList()
    list?.addEventListener("change", onChange)
    return () => list?.removeEventListener("change", onChange)
}

/** True on an expanded window (1024px and up). False while the page hydrates, as on the server. */
export const useIsExpandedWindow = (): boolean =>
    useSyncExternalStore(
        subscribe,
        () => expandedList()?.matches ?? false,
        () => false,
    )
