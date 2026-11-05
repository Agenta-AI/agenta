import {useRef} from "react"

/**
 * True from the first render `open` is true, and true after that. A surface gated on it costs
 * nothing until it is first opened, then stays mounted so its slide-out still plays.
 */
export const useHasOpened = (open: boolean): boolean => {
    const opened = useRef(open)
    if (open) opened.current = true
    return opened.current
}
