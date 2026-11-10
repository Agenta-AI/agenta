import {useState} from "react"

/**
 * True from the first render `open` is true, and true after that. A surface gated on it costs
 * nothing until it is first opened, then stays mounted so its slide-out still plays.
 */
export const useHasOpened = (open: boolean): boolean => {
    const [opened, setOpened] = useState(open)
    if (open && !opened) setOpened(true)
    return open || opened
}
