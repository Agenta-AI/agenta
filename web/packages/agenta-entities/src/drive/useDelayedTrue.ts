import {useEffect, useState} from "react"

/** True only after `active` has held for `ms` — so a fast load (data back in <ms) never flashes the
 * loading state; it just crossfades straight to the content. Cancels cleanly on unmount/toggle. */
export const useDelayedTrue = (active: boolean, ms: number): boolean => {
    const [on, setOn] = useState(false)
    useEffect(() => {
        if (!active) {
            setOn(false)
            return
        }
        const t = window.setTimeout(() => setOn(true), ms)
        return () => window.clearTimeout(t)
    }, [active, ms])
    return on
}
