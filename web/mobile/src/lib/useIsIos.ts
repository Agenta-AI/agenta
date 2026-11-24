import {useSyncExternalStore} from "react"

const noop = () => () => undefined

/** iOS and iPadOS Safari (an iPad reports itself as a Mac with touch). False on the server. */
export const useIsIos = (): boolean =>
    useSyncExternalStore(
        noop,
        () =>
            /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
        () => false,
    )
