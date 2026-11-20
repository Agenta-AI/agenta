import {useMediaQuery} from "../hooks/useMediaQuery"

/**
 * Below this width the app shows one pane at a time and every panel is a full screen view.
 * Production's `md` edge, the one the session panes already use.
 */
export const PHONE_BELOW = 768

/** The media query that matches a phone window. */
export const PHONE_QUERY = `(max-width: ${PHONE_BELOW - 0.02}px)`

/**
 * True on a phone window. False on the server and on the first client render, like every media
 * query here: a container that decides the layout reads it once and passes it down.
 */
export const useIsPhone = (): boolean => useMediaQuery(PHONE_QUERY)
