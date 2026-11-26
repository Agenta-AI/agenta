const MODEL_KEYS = ["model", "model_name", "modelName", "engine"] as const

const MAX_DEPTH = 6

const search = (value: unknown, depth: number, visited: Set<unknown>): string => {
    if (!value || typeof value !== "object" || depth > MAX_DEPTH) return ""
    if (visited.has(value)) return ""
    visited.add(value)

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = search(item, depth + 1, visited)
            if (found) return found
        }
        return ""
    }

    const record = value as Record<string, unknown>
    for (const key of MODEL_KEYS) {
        const candidate = record[key]
        if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim()
    }
    for (const nested of Object.values(record)) {
        const found = search(nested, depth + 1, visited)
        if (found) return found
    }
    return ""
}

/**
 * The model name a revision's parameters set, or "" when they set none.
 *
 * Only the model keys count (`model`, `model_name`, `modelName`, `engine`), so prompt text that
 * mentions a model is never returned.
 */
export const pickModelName = (parameters: unknown): string => search(parameters, 0, new Set())
