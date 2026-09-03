const SLUG_SUFFIX_CHAR_SET = "0123456789abcdefghijklmnopqrstuvwxyz"

function randomSuffix(length: number): string {
    if (globalThis.crypto?.getRandomValues) {
        const randomValues = new Uint32Array(length)
        globalThis.crypto.getRandomValues(randomValues)

        return Array.from(
            randomValues,
            (value) => SLUG_SUFFIX_CHAR_SET[value % SLUG_SUFFIX_CHAR_SET.length],
        ).join("")
    }

    return Array.from(
        {length},
        () => SLUG_SUFFIX_CHAR_SET[Math.floor(Math.random() * SLUG_SUFFIX_CHAR_SET.length)],
    ).join("")
}

/**
 * Sanitized, kebab-cased slug base (no random suffix), matching the BACKEND slug
 * normalization: NFKD-normalize, drop non-word chars (keeps `_`, drops `.`), collapse
 * hyphen/whitespace runs. Use this when the backend derives the same slug from the same
 * name (vault secrets); use `slugifyName` for client-generated entity slugs.
 */
export function slugifyBase(name: string): string {
    return name
        ?.normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, "-")
}

/**
 * Converts a display name to a URL-safe slug base for CLIENT-generated entity slugs (it
 * keeps `.` and strips leading/trailing hyphens, so it satisfies `isValidSlug`). The
 * suffix helpers below all build on this one. For backend parity use `slugifyBase`.
 */
export function slugifyName(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_.\-\s]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
}

/**
 * Generates a slug with a random 4-character suffix to reduce collision probability.
 */
export function generateSlugWithSuffix(name: string): string {
    const base = slugifyName(name) || "resource"
    return `${base}-${randomSuffix(4)}`
}

/**
 * Updates the slug base from a display name while preserving an existing suffix.
 */
export function generateSlugWithExistingSuffix(name: string, suffix?: string | null): string {
    const base = slugifyName(name) || "resource"
    return suffix ? `${base}-${suffix}` : generateSlugWithSuffix(name)
}

/**
 * Replaces a known generated suffix with a new random 4-character suffix.
 * If the current slug no longer ends with that known suffix, append a new one.
 */
export function regenerateSlugSuffix(slug: string, suffixToReplace?: string | null): string {
    const normalizedSlug = slugifyName(slug) || "resource"
    const normalizedSuffix = suffixToReplace?.toLowerCase()
    const suffixMarker = normalizedSuffix ? `-${normalizedSuffix}` : ""
    const base =
        suffixMarker && normalizedSlug.endsWith(suffixMarker)
            ? normalizedSlug.slice(0, -suffixMarker.length) || "resource"
            : normalizedSlug

    return `${base}-${randomSuffix(4)}`
}

/**
 * Returns the last generated-looking 4-character suffix, if present.
 */
export function getSlugSuffix(slug: string): string | null {
    const match = slug.match(/-([a-z0-9]{4})$/)
    return match ? match[1] : null
}

/**
 * Strips the last hyphen-separated segment if it looks like a 4-character suffix.
 */
export function stripSlugSuffix(slug: string): string {
    const suffix = getSlugSuffix(slug)
    return suffix ? slug.slice(0, -(suffix.length + 1)) : slug
}

/**
 * Returns true if the slug contains only valid characters.
 */
export function isValidSlug(slug: string): boolean {
    if (slug.length < 1 || slug.length > 255) return false
    if (/\.{2,}|-{2,}/.test(slug)) return false
    return /^[a-z0-9][a-z0-9_.\-]*[a-z0-9]$/.test(slug) || /^[a-z0-9]$/.test(slug)
}

/**
 * Converts an arbitrary label into an env-var-style name: `x-api-key` -> `X_API_KEY`.
 *
 * Splits on separator runs rather than collapsing then trimming them: dropping the empty
 * segments strips leading/trailing separators for free, and it keeps the whole thing linear
 * (a trailing `_+$` trim is polynomial-time on separator runs, which CodeQL flags).
 */
export function toEnvVarName(value: string): string {
    return value
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .join("_")
        .toUpperCase()
}
