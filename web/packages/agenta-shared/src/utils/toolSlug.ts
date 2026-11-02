export interface GatewayToolSlugParts {
    provider: string
    integration: string
    action: string
    connection: string
}

// Gateway tool function name format:
// tools__{provider}__{integration}__{action}__{connection}
// Double-underscore is used because LLM providers forbid dots in function names.
// Segments may contain single underscores (e.g. CREATE_EMAIL_DRAFT); only "__" is a separator.
export function parseGatewayToolSlug(name: string | undefined): GatewayToolSlugParts | null {
    if (!name) return null
    const parts = name.split("__")
    if (parts.length !== 5 || parts[0] !== "tools") return null
    const [, provider, integration, action, connection] = parts
    if (!provider || !integration || !action || !connection) return null
    return {provider, integration, action, connection}
}

export function isGatewayToolSlug(name: string | undefined): boolean {
    return parseGatewayToolSlug(name) !== null
}

// Double-underscore separator: valid for LLM function names (no dots allowed)
// and accepted by the /tools/call API which normalises __ → . before parsing.
export const buildGatewayToolSlug = (
    provider: string,
    integration: string,
    action: string,
    connectionSlug: string,
) => `tools__${provider}__${integration}__${action}__${connectionSlug}`

// Whole-word tokens kept uppercase when humanizing an action key (GitHub/Composio actions are
// littered with these). Everything else is sentence-cased.
const ACTION_ACRONYMS = new Set([
    "API",
    "URL",
    "URI",
    "ID",
    "PR",
    "CI",
    "CD",
    "SSO",
    "SSH",
    "IP",
    "DNS",
    "SLA",
    "SMS",
    "PDF",
    "CSV",
    "JSON",
    "HTTP",
    "HTTPS",
    "SDK",
    "UUID",
    "GPG",
    "OAUTH",
    "2FA",
    "MFA",
])

/**
 * `ADD_ASSIGNEES_TO_AN_ISSUE` → "Add assignees to an issue". Sentence-cased, acronyms kept.
 * Pass `integration` to drop a key that repeats it (`GITHUB_ADD_ASSIGNEES` → "Add assignees").
 */
export function humanizeActionKey(key: string, integration?: string): string {
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
