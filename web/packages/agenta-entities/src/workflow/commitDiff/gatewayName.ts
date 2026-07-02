/**
 * Gateway tool function names are encoded as
 * `tools__{provider}__{integration}__{ACTION}__{connection}` (double underscores
 * because LLM APIs forbid dots in function names). Turn one into a friendly label
 * + source so the commit summary never shows `tools__composio__gmail__ADD_LABEL__b81`.
 */
export interface ParsedToolName {
    label: string
    source?: string
}

function titleCase(token: string): string {
    const cleaned = token.replace(/[_-]+/g, " ").trim().toLowerCase()
    if (!cleaned) return token
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export function parseGatewayToolName(name: string): ParsedToolName {
    if (!name) return {label: name}

    const parts = name.split("__").filter(Boolean)
    // tools__provider__integration__ACTION[__connection]
    if (parts[0] === "tools" && parts.length >= 4) {
        const integration = parts[2]
        const action = parts[3]
        return {
            label: titleCase(action),
            source: titleCase(integration),
        }
    }

    // Plain function name (e.g. "gmail_search_emails") — humanize it.
    return {label: titleCase(name)}
}
