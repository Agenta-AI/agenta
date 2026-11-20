import {useSyncExternalStore} from "react"

/**
 * Below this width the app shows one pane at a time and every panel is a full screen view.
 * Production's `md` edge, the one the session panes already use.
 */
export const PHONE_BELOW = 768

/** The media query that matches a phone window. */
export const PHONE_QUERY = `(max-width: ${PHONE_BELOW - 0.02}px)`

const phoneList = () =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null

const subscribe = (onChange: () => void) => {
    const list = phoneList()
    list?.addEventListener("change", onChange)
    return () => list?.removeEventListener("change", onChange)
}

/**
 * True on a phone window. A component that mounts after the page loaded (a drawer, a sheet)
 * reads the real width on its first render, so a read-only view never shows an edit control for
 * a frame. While the page hydrates it is false, as on the server.
 */
export const useIsPhone = (): boolean =>
    useSyncExternalStore(
        subscribe,
        () => phoneList()?.matches ?? false,
        () => false,
    )
