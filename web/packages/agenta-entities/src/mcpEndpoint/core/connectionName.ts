/**
 * What a new MCP connection is called before anyone types anything.
 *
 * A server name does not identify an account, and the same server can hold several, so the
 * suggestion has to be distinguishable rather than merely plausible. Display names are
 * unique per project, so a suggestion that collides is disambiguated here rather than
 * bounced back at the person as a validation error on a field they never filled in.
 *
 * `serverInfo.name` is preferred when the probe got one, and the hostname is the fallback:
 * an authenticated server may refuse to say anything about itself before consent, which is
 * exactly when the person is being asked for a name.
 */

/** The ordinals the integrations flow uses, so both surfaces read the same. */
const ORDINALS = ["main", "secondary"]

/** The readable part of a URL: its host, with a leading `www.` dropped. */
export function hostnameLabel(url: string): string {
    try {
        const {hostname} = new URL(url)
        return hostname.replace(/^www\./, "")
    } catch {
        return ""
    }
}

/**
 * The form the API deduplicates on: every character outside `[A-Za-z0-9_]` becomes an
 * underscore. Two labels that normalize alike are one name to the platform, so "Acme Tools"
 * and "Acme-Tools" collide even though they read differently.
 *
 * This mirrors the server rule rather than inventing a friendlier one. A client check that
 * is laxer lets a person submit a name the API then refuses; one that is stricter refuses a
 * name the API would have taken.
 */
export const normalizeConnectionName = (name: string): string =>
    name.trim().replace(/[^A-Za-z0-9_]/g, "_")

const normalize = normalizeConnectionName

/**
 * A display name for a new connection that no existing connection already uses.
 *
 * The first connection to a server is offered the bare name; a second is offered
 * "(secondary)" and later ones a number, matching `defaultConnectionName` in
 * `@agenta/shared/utils`. That utility counts per integration key, which custom MCP rows do
 * not have, so this counts per name collision instead — and it compares the way the API
 * does, so a suggestion is never one the API would reject.
 */
export function suggestConnectionName({
    serverName,
    url,
    existingNames = [],
}: {
    serverName?: string | null
    url: string
    existingNames?: (string | null | undefined)[]
}): string {
    const base = (serverName || "").trim() || hostnameLabel(url) || "MCP server"
    const taken = new Set(existingNames.filter((name): name is string => !!name).map(normalize))

    if (!taken.has(normalize(base))) return base

    for (let index = 1; index < 100; index++) {
        const ordinal = ORDINALS[index] ?? String(index + 1)
        const candidate = `${base} (${ordinal})`
        if (!taken.has(normalize(candidate))) return candidate
    }
    return base
}

/**
 * Why this display name cannot be used, or null when it can.
 *
 * Compared on the normalized form the API deduplicates on, so this refuses exactly what a
 * save would refuse.
 */
export function connectionNameProblem({
    name,
    existingNames = [],
    currentName,
}: {
    name: string
    existingNames?: (string | null | undefined)[]
    /** The name this connection already has, which is never a collision with itself. */
    currentName?: string | null
}): string | null {
    const trimmed = name.trim()
    if (!trimmed) return "Enter a name."

    const mine = currentName ? normalize(currentName) : null
    const taken = existingNames
        .filter((existing): existing is string => !!existing)
        .map(normalize)
        .filter((existing) => existing !== mine)

    if (taken.includes(normalize(trimmed))) {
        return "Another connection in this project already uses this name."
    }
    return null
}
