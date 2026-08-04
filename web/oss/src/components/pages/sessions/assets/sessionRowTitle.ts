/**
 * What a session row leads with.
 *
 * A session gets a name when someone types one. Automation runs never do — nobody was there —
 * so every one of them rendered "Untitled session" over the only informative thing in the row.
 * A nameless session leads with its message instead, and drops the second line rather than
 * printing the same text twice.
 *
 * The rule is deliberately not "is this an automation": the stream row carries no origin (the
 * list only knows because it asked the server to filter), and a nameless manual session has the
 * same problem anyway.
 */
export interface SessionRowTitle {
    title: string
    /** Null when the title IS the message. */
    subtitle: string | null
}

export function sessionRowTitle(
    name: string | null | undefined,
    preview: string | null,
): SessionRowTitle {
    const named = name?.trim()
    if (named) return {title: named, subtitle: preview}
    if (preview) return {title: preview, subtitle: null}
    return {title: "Untitled session", subtitle: null}
}
