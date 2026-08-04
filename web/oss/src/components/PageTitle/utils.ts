export const DEFAULT_PAGE_TITLE = "Agenta"
export const SESSION_TITLE_MAX_LENGTH = 60

export const normalizeTitlePart = (value?: string | null): string =>
    value?.replace(/\s+/g, " ").trim() ?? ""

export const truncateTitlePart = (value: string, maxLength: number): string => {
    // Server-persisted titles may arrive cut on a UTF-16 boundary; a trailing high surrogate
    // has no pair left and renders as a replacement character.
    const normalized = normalizeTitlePart(value).replace(/[\uD800-\uDBFF]$/, "")
    const characters = Array.from(normalized)
    if (characters.length <= maxLength) return normalized
    return `${characters
        .slice(0, Math.max(0, maxLength - 1))
        .join("")
        .trimEnd()}…`
}

export const formatPageTitle = (title?: string | null, context?: string | null): string => {
    const normalizedTitle = normalizeTitlePart(title)
    if (!normalizedTitle) return DEFAULT_PAGE_TITLE

    return `${normalizedTitle} | ${normalizeTitlePart(context) || DEFAULT_PAGE_TITLE}`
}
