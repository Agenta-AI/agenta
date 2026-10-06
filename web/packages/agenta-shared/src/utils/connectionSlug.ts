/**
 * Slugify a string for use as a connection slug.
 *
 * Rules:
 * - Lowercase
 * - Replace spaces and underscores with hyphens
 * - Strip any character that is not [a-z0-9-]
 * - Collapse consecutive hyphens to one
 * - Trim leading/trailing hyphens
 */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
}

/**
 * Generate a random alphanumeric string of length `n` (lowercase).
 */
export function randomAlphanumeric(n: number): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    let result = ""
    for (let i = 0; i < n; i++) {
        result += chars[Math.floor(Math.random() * chars.length)]
    }
    return result
}

/**
 * Generate a default connection slug from a display name.
 *
 * Format: `slugify(name)-<3-char random suffix>`
 * Example: "Google Calendar" → "google-calendar-7mx"
 */
export function generateDefaultSlug(name: string, suffix = randomAlphanumeric(3)): string {
    const base = slugify(name)
    return base ? `${base}-${suffix}` : suffix
}

/** Ordinal words for the first connections of an integration; later ones fall back to a number. */
const CONNECTION_ORDINALS = ["main", "secondary"]

/**
 * The name a new connection is offered, given how many the integration already has.
 * "GitHub" → "GitHub (main)", then "GitHub (secondary)", then "GitHub (3)".
 */
export function defaultConnectionName(integrationName: string, existingCount = 0): string {
    const base = integrationName.trim() || "Connection"
    const index = Math.max(0, Math.trunc(existingCount))
    const ordinal = CONNECTION_ORDINALS[index] ?? String(index + 1)
    return `${base} (${ordinal})`
}

/** Lowercase, with `_` and spaces read as `-`, so "google_maps" and "google-maps" compare equal. */
const asIdentifier = (value: string): string =>
    value
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-")

/**
 * What a connection is CALLED in the UI. A slug is an identifier, never a label.
 *
 * Connections made outside the connect form often store their slug or integration key as their
 * name ("youtube-main", "google_maps"). With the app's name, such a connection reads as the app,
 * plus what the slug adds after the integration key: "youtube-main" → "YouTube (main)".
 * Without it, or with a real name, the name (else the slug) is shown as stored.
 */
export function connectionDisplayName(
    connection:
        | {name?: string | null; slug?: string | null; integration_key?: string | null}
        | null
        | undefined,
    appName?: string | null,
): string {
    const name = connection?.name?.trim() ?? ""
    const slug = connection?.slug?.trim() ?? ""
    const key = connection?.integration_key?.trim() ?? ""
    const app = appName?.trim() ?? ""

    const identifiers = [slug, key].filter(Boolean).map(asIdentifier)
    const nameIsIdentifier = !name || identifiers.includes(asIdentifier(name))
    if (!nameIsIdentifier || !app) return name || slug

    const slugId = asIdentifier(slug)
    const keyId = asIdentifier(key)
    const rest =
        keyId && slugId.startsWith(`${keyId}-`) ? slugId.slice(keyId.length + 1) : ""
    return rest ? `${app} (${rest})` : app
}
