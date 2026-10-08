import {useEffect, useState} from "react"

/** Set by the screen being left: the browser already animated this back/forward (iOS swipe). */
let browserAnimatedLastPop = false

/**
 * Whether a newly mounted screen should play its enter animation — every navigation does, except
 * one the browser already animated itself, which would otherwise play twice.
 */
export function useScreenEnter(): boolean {
    const [enter] = useState(() => !browserAnimatedLastPop)

    useEffect(() => {
        browserAnimatedLastPop = false
        const onPopState = (event: PopStateEvent) => {
            browserAnimatedLastPop = event.hasUAVisualTransition === true
        }
        window.addEventListener("popstate", onPopState)
        return () => window.removeEventListener("popstate", onPopState)
    }, [])

    return enter
}
