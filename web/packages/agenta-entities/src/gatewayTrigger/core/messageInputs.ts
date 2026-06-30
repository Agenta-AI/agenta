/**
 * Friendly single "message" <-> a schedule's `inputs_fields`.
 *
 * A cron tick delivers `inputs_fields` verbatim as the agent's `inputs`. Chat agents
 * take a `messages` array; completion agents take their schema's named string inputs.
 * The composer edits one message; these pure helpers read/write it into the right
 * shape, preserving any other keys the user set via the raw-JSON editor.
 *
 * `isChat` and `primaryKey` are resolved by the caller from the bound agent's schema
 * (`workflowMolecule.selectors.isChat` + `extractInputPortsFromSchema`).
 */

function parseObject(inputsText: string): Record<string, unknown> {
    try {
        const parsed = inputsText.trim() ? JSON.parse(inputsText) : {}
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {}
    } catch {
        return {}
    }
}

/** Read the message out of `inputs_fields`. Empty string when absent or unparseable. */
export function getScheduleMessage(
    inputsText: string,
    isChat: boolean,
    primaryKey: string,
): string {
    const obj = parseObject(inputsText)
    if (isChat) {
        const messages = Array.isArray(obj.messages) ? (obj.messages as unknown[]) : []
        const user =
            (messages.find(
                (m) => !!m && typeof m === "object" && (m as {role?: string}).role === "user",
            ) as {content?: unknown} | undefined) ??
            (messages[0] as {content?: unknown} | undefined)
        return typeof user?.content === "string" ? user.content : ""
    }
    const value = obj[primaryKey]
    return typeof value === "string" ? value : ""
}

/** Write the message into `inputs_fields`, returning the serialized JSON. */
export function setScheduleMessage(
    inputsText: string,
    message: string,
    isChat: boolean,
    primaryKey: string,
): string {
    const obj = parseObject(inputsText)
    const trimmed = message.trim()
    if (isChat) {
        if (trimmed) obj.messages = [{role: "user", content: message}]
        else delete obj.messages
    } else if (trimmed) {
        obj[primaryKey] = message
    } else {
        delete obj[primaryKey]
    }
    return Object.keys(obj).length ? JSON.stringify(obj, null, 2) : "{}"
}

/**
 * Best-effort message preview from a resolved `inputs_fields` object — for list rows
 * where the agent schema isn't handy. Reads the first chat user message, else the first
 * non-empty string value. Empty string when there's nothing to show.
 */
export function getScheduleMessagePreview(inputsFields: unknown): string {
    if (!inputsFields || typeof inputsFields !== "object" || Array.isArray(inputsFields)) return ""
    const obj = inputsFields as Record<string, unknown>
    if (Array.isArray(obj.messages)) {
        const msgs = obj.messages as unknown[]
        const user =
            (msgs.find(
                (m) => !!m && typeof m === "object" && (m as {role?: string}).role === "user",
            ) as {content?: unknown} | undefined) ?? (msgs[0] as {content?: unknown} | undefined)
        return typeof user?.content === "string" ? user.content : ""
    }
    for (const value of Object.values(obj)) {
        if (typeof value === "string" && value.trim()) return value
    }
    return ""
}
