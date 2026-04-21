const SLUG_DIGIT_SET = "0123456789"

function randomDigits(length: number): string {
    return Array.from(
        {length},
        () => SLUG_DIGIT_SET[Math.floor(Math.random() * SLUG_DIGIT_SET.length)],
    ).join("")
}

/**
 * Converts a display name to a URL-safe slug base.
 * Result is lowercase, hyphen-separated, no leading/trailing hyphens.
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
 * Generates a slug with a random 4-digit suffix to reduce collision probability.
 */
export function generateSlugWithSuffix(name: string): string {
    const base = slugifyName(name) || "resource"
    return `${base}-${randomDigits(4)}`
}

function getRandomSuffix(slug: string): string | null {
    const match = slug.match(/-(\d{4})$/)
    return match ? match[1] : null
}

/**
 * Replaces a known generated suffix with a new random 4-digit suffix.
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

    return `${base}-${randomDigits(4)}`
}

/**
 * Strips the last hyphen-separated segment if it looks like a 4-digit suffix.
 */
export function stripSlugSuffix(slug: string): string {
    const suffix = getRandomSuffix(slug)
    return suffix ? slug.slice(0, -(suffix.length + 1)) : slug
}

/**
 * Returns the last generated-looking 4-digit suffix, if present.
 */
export function getSlugSuffix(slug: string): string | null {
    return getRandomSuffix(slug)
}

/**
 * Returns true if the slug contains only valid characters.
 */
export function isValidSlug(slug: string): boolean {
    if (slug.length < 1 || slug.length > 255) return false
    if (/\.{2,}|-{2,}/.test(slug)) return false
    return /^[a-z0-9][a-z0-9_.\-]*[a-z0-9]$/.test(slug) || /^[a-z0-9]$/.test(slug)
}
