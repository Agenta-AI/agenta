/**
 * Copy text to the clipboard. Answers whether it worked; never throws and never logs an error.
 *
 * `navigator.clipboard` exists only in a secure context (HTTPS or localhost). A self-hosted app
 * on plain HTTP has none, and a browser can refuse the write: both fall back to selecting the
 * text in a hidden text area and `document.execCommand("copy")`.
 */
const copyBySelection = (text: string): boolean => {
    if (typeof document === "undefined" || !document.body) return false
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.top = "0"
    area.style.left = "0"
    area.style.opacity = "0"
    // Inside the open dialog when there is one: a modal keeps focus in its own scope, so a
    // text area outside it could not be focused and selected. Focus goes back afterwards.
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const host = previous?.closest<HTMLElement>("[role=dialog],[role=alertdialog]") ?? document.body
    try {
        host.appendChild(area)
        area.focus()
        area.select()
        return typeof document.execCommand === "function" && document.execCommand("copy")
    } catch {
        return false
    } finally {
        area.remove()
        previous?.focus()
    }
}

export const copyToClipboard = async (text: string): Promise<boolean> => {
    if (!text) return false
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined
    if (clipboard?.writeText) {
        try {
            await clipboard.writeText(text)
            return true
        } catch {
            // Refused (no permission, not focused): try the selection below.
        }
    }
    return copyBySelection(text)
}
