/** Marks the root element of a mounted conversation; its value is the conversation's role. */
export const CONVERSATION_ROLE_ATTR = "data-conversation-role"

/**
 * True when a run or approval shortcut belongs to the conversation under `root`. Two conversations
 * can be on screen (the session and the builder chat), and one key must act on one of them only.
 * The focused conversation owns the key. With the focus in neither, the page conversation owns it.
 */
export const ownsConversationShortcut = (
    root: Element | null,
    active: Element | null = typeof document === "undefined" ? null : document.activeElement,
): boolean => {
    if (!root) return false
    const focused = active?.closest(`[${CONVERSATION_ROLE_ATTR}]`)
    if (focused) return focused === root
    return root.getAttribute(CONVERSATION_ROLE_ATTR) === "page"
}
