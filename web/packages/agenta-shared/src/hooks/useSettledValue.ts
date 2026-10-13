import {useEffect, useState} from "react"

/** `value` as it was at mount, then each later value once it has held still for `delayMs`. */
export function useSettledValue<T>(value: T, delayMs = 300): T {
    const [settled, setSettled] = useState(value)
    useEffect(() => {
        if (Object.is(value, settled)) return
        const timer = setTimeout(() => setSettled(value), delayMs)
        return () => clearTimeout(timer)
    }, [value, settled, delayMs])
    return settled
}
