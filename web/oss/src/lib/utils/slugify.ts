// Utility function to build deterministic slug keys identical to backend implementation
// Combines a sanitized, kebab-cased version of `name` with the last 4 chars of `id`.
// Keeps logic in one place so it can be reused across services/hooks without duplication.

export const slugify = (name: string, id: string): string => {
    const normalized = name
        ?.normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, "-")

    const suffix = id?.slice(-12) || ""
    return `${normalized}-${suffix}`
}
