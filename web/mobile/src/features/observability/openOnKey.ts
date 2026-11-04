import type {KeyboardEvent} from "react"

/**
 * Enter and Space on a row run `open`, as a click does. Only the row's own key presses count: a
 * button inside the row keeps its keys.
 */
export const openOnKey = (open: () => void) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        open()
    }
}
