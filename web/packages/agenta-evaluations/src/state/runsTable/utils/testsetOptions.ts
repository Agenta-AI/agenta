const extractTestsetId = (testset: unknown): string | null => {
    if (!testset || typeof testset !== "object") {
        return null
    }
    const asAny = testset as Record<string, unknown>
    const rawId = asAny._id ?? asAny.id
    if (typeof rawId !== "string") {
        return null
    }
    const trimmed = rawId.trim()
    return trimmed.length ? trimmed : null
}

const extractTestsetLabel = (testset: unknown, fallback: string) => {
    if (!testset || typeof testset !== "object") {
        return fallback
    }
    const asAny = testset as Record<string, unknown>
    const name = typeof asAny.name === "string" ? asAny.name.trim() : ""
    return name.length ? name : fallback
}

export const buildTestsetOptions = (testsets?: unknown[]) => {
    const entries = Array.isArray(testsets) ? testsets : []
    const seen = new Set<string>()
    return entries
        .map((testset) => {
            const id = extractTestsetId(testset)
            if (!id || seen.has(id)) {
                return null
            }
            seen.add(id)
            const label = extractTestsetLabel(testset, id)
            return {value: id, label}
        })
        .filter((option): option is {value: string; label: string} => Boolean(option))
        .sort((a, b) => a.label.localeCompare(b.label))
}
