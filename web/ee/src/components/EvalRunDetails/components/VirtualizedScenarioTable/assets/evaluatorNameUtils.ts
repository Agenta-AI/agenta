const toIterable = (input: any): any[] => {
    if (!input) return []
    if (Array.isArray(input)) return input
    if (typeof input === "object") return Object.values(input)
    return []
}

const pickString = (candidate: unknown): string | undefined => {
    if (typeof candidate === "string") {
        const trimmed = candidate.trim()
        if (trimmed.length) return trimmed
    }
    return undefined
}

const extractSlug = (entry: any): string | undefined => {
    return (
        pickString(entry?.slug) ??
        pickString(entry?.key) ??
        pickString(entry?.id) ??
        pickString(entry?.meta?.slug) ??
        pickString(entry?.flags?.slug)
    )
}

const extractName = (entry: any): string | undefined => {
    const candidates = [
        entry?.name,
        entry?.displayName,
        entry?.display_name,
        entry?.title,
        entry?.meta?.displayName,
        entry?.meta?.display_name,
        entry?.meta?.name,
        entry?.flags?.display_name,
        entry?.flags?.name,
        entry?.data?.display_name,
    ]
    for (const candidate of candidates) {
        const resolved = pickString(candidate)
        if (resolved) return resolved
    }
    return undefined
}

export const buildEvaluatorNameMap = (
    ...sources: Array<Iterable<any> | Record<string, any> | null | undefined>
): Record<string, string> => {
    const map = new Map<string, string>()
    const register = (entry: any) => {
        if (!entry) return
        const slug = extractSlug(entry)
        if (!slug || map.has(slug)) return
        const name = extractName(entry)
        if (name) {
            map.set(slug, name)
        }
    }
    sources.forEach((source) => {
        toIterable(source).forEach(register)
    })
    return Object.fromEntries(map.entries())
}

export const createEvaluatorNameResolver = (
    namesBySlug?: Record<string, string>,
): ((slug?: string | null) => string) => {
    const resolvedNames = namesBySlug ?? {}
    const fallback = new Map<string, string>()
    let unnamedCounter = 1

    return (rawSlug?: string | null) => {
        const slug = pickString(rawSlug)
        if (slug) {
            const mapped = pickString(resolvedNames[slug])
            if (mapped) return mapped
            if (fallback.has(slug)) return fallback.get(slug) as string
            const label = `Evaluator ${unnamedCounter++}`
            fallback.set(slug, label)
            return label
        }

        const genericLabel = `Evaluator ${unnamedCounter++}`
        return genericLabel
    }
}
