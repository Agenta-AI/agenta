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
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "")
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
