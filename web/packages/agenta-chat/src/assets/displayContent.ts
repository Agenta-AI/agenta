import type {UIMessage} from "ai"

export const getDisplayContent = (message: UIMessage): string | null | undefined => {
    const metadata = message.metadata as Record<string, unknown> | undefined
    const value = metadata?.display_content
    return value === null || typeof value === "string" ? value : undefined
}

export const displayMessage = (message: UIMessage): UIMessage => {
    const content = getDisplayContent(message)
    if (content === undefined) return message
    return {
        ...message,
        parts:
            content === null
                ? []
                : [
                      {type: "text", text: content},
                      ...message.parts.filter((part) => part.type !== "text"),
                  ],
    }
}

export const displayMessageText = (message: UIMessage): string =>
    displayMessage(message)
        .parts.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")

/** Preserve the original execution context when editing a display-only projection. */
export const editedExecutionText = (source: UIMessage | null, text: string): string | undefined => {
    if (!source || getDisplayContent(source) === undefined) return undefined
    const original = source.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
    return `${original}\n\nUpdated user request (replaces the earlier visible request; retain its supporting context):\n${text}`
}

const editKey = (sessionId: string) => `agenta:display-edit:${sessionId}`
export const readDisplayEdit = (sessionId: string): UIMessage | null => {
    if (typeof window === "undefined") return null
    try {
        const value = JSON.parse(
            sessionStorage.getItem(editKey(sessionId)) ?? "null",
        ) as UIMessage | null
        return value && typeof value.id === "string" && Array.isArray(value.parts) ? value : null
    } catch {
        return null
    }
}
export const saveDisplayEdit = (sessionId: string, message: UIMessage | null): void => {
    if (typeof window === "undefined") return
    try {
        if (message && getDisplayContent(message) !== undefined)
            sessionStorage.setItem(editKey(sessionId), JSON.stringify(message))
        else sessionStorage.removeItem(editKey(sessionId))
    } catch {
        /* The in-memory edit still works if browser storage is unavailable. */
    }
}
