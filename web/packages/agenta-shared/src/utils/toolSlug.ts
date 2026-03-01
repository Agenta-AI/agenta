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
