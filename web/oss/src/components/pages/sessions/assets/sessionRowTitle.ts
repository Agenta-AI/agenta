/**
 * What a session row leads with.
 *
 * A session gets a name when someone types one, so automation runs never have one — nobody was
 * there. Such a row led with "Untitled session" over the only informative thing it had.
 *
 * Precedence is by how specific the label is: a typed name, then the automation that fired the
 * run, then the message itself. The message is dropped from the second line when it is already
 * the title, so a row never prints the same text twice.
 */
export interface SessionRowTitle {
    title: string
    /** Null when the title IS the message. */
    subtitle: string | null
}

export function sessionRowTitle(
    name: string | null | undefined,
    preview: string | null,
    triggerName?: string | null,
): SessionRowTitle {
    const named = name?.trim()
    if (named) return {title: named, subtitle: preview}
    if (triggerName) return {title: triggerName, subtitle: preview}
    if (preview) return {title: preview, subtitle: null}
    return {title: "Untitled session", subtitle: null}
}
