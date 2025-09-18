export const sanitizeRevisionIds = (ids: (string | null | undefined)[]): string[] => {
    const filtered = (ids || [])
        .map((id) => (typeof id === "string" ? id.trim() : id))
        .filter((id): id is string => !!id && id !== "null" && id !== "undefined")
    return Array.from(new Set(filtered))
}

export const buildRevisionsQueryParam = (
    ids: (string | null | undefined)[],
): string | undefined => {
    const clean = sanitizeRevisionIds(ids)
    return clean.length ? JSON.stringify(clean) : undefined
}
