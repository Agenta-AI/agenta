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

/** Tokens a humanized action key keeps uppercase. */
const ACTION_ACRONYMS = new Set([
    "API",
    "ID",
    "URL",
    "URI",
    "HTTP",
    "JSON",
    "CSV",
    "PDF",
    "SDK",
    "UUID",
    "OAUTH",
    "2FA",
    "MFA",
])

/**
 * `GMAIL_ADD_LABEL` + `gmail` → "Add label". Sentence-cased, acronyms kept, and an action key
 * that repeats its integration loses the prefix — the row names the app separately.
 *
 * Deliberately local. `@agenta/entity-ui` has a one-argument version of this and there is a
 * branch in flight moving a two-argument one into `@agenta/shared`; entities can reach neither
 * today (entity-ui is the wrong direction, and the shared one has not landed). Converge on the
 * shared helper once that lands rather than growing a third copy.
 */
export function humanizeGatewayAction(key: string, integration?: string): string {
    const prefix = integration ? `${integration.toUpperCase()}_` : ""
    const stripped = prefix && key.toUpperCase().startsWith(prefix) ? key.slice(prefix.length) : key
    const words = stripped
        .toLowerCase()
        .split(/[_\s]+/)
        .filter(Boolean)
    if (words.length === 0) return key
    return words
        .map((word, index) => {
            const upper = word.toUpperCase()
            if (ACTION_ACRONYMS.has(upper)) return upper
            return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
        })
        .join(" ")
}

/** `gmail` / `GMAIL` / `my_app` → `Gmail` / `My app`. */
export function titleCase(token: string): string {
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

    // Generic short form: {source}__ACTION (e.g. "gmail__FETCH_EMAILS").
    if (parts.length >= 2) {
        return {
            label: titleCase(parts[parts.length - 1]),
            source: titleCase(parts[parts.length - 2]),
        }
    }

    // Plain function name (e.g. "gmail_search_emails") — humanize it.
    return {label: titleCase(name)}
}
