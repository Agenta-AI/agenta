export const toArray = (value: any): any[] => {
    if (!value) return []
    if (Array.isArray(value)) return value
    if (typeof value === "object") return Object.values(value)
    return []
}

export const pickString = (candidate: unknown): string | undefined => {
    if (typeof candidate === "string") {
        const trimmed = candidate.trim()
        if (trimmed.length > 0) return trimmed
    }
    return undefined
}

export const collectEvaluatorIdentifiers = (entry: any): string[] => {
    if (!entry || typeof entry !== "object") return []
    const ids = new Set<string>()
    ;[
        entry?.slug,
        entry?.id,
        entry?.key,
        entry?.uid,
        entry?.meta?.evaluator_key,
        entry?.flags?.evaluator_key,
        entry?.data?.slug,
        entry?.data?.id,
        entry?.data?.key,
        entry?.data?.evaluator_key,
    ].forEach((candidate) => {
        const value = pickString(candidate)
        if (value) ids.add(value.toLowerCase())
    })
    return Array.from(ids)
}

const mergePlainObjects = (primary: any, fallback: any): any => {
    if (primary === undefined || primary === null) return fallback
    if (fallback === undefined || fallback === null) return primary

    const primaryIsObject = typeof primary === "object" && !Array.isArray(primary)
    const fallbackIsObject = typeof fallback === "object" && !Array.isArray(fallback)

    if (primaryIsObject && fallbackIsObject) {
        const result: Record<string, any> = {...fallback}
        Object.entries(primary).forEach(([key, value]) => {
            result[key] = mergePlainObjects(value, (fallback as Record<string, any>)[key])
        })
        return result
    }

    return primary
}

export const mergeEvaluatorRecords = (runEvaluator?: any, catalogEvaluator?: any): any => {
    if (!runEvaluator) return catalogEvaluator
    if (!catalogEvaluator) return runEvaluator

    const merged: Record<string, any> = {
        ...catalogEvaluator,
        ...runEvaluator,
    }

    merged.data = mergePlainObjects(runEvaluator?.data, catalogEvaluator?.data)
    merged.settings_values = mergePlainObjects(
        runEvaluator?.settings_values,
        catalogEvaluator?.settings_values,
    )
    merged.metrics = mergePlainObjects(runEvaluator?.metrics, catalogEvaluator?.metrics)

    return merged
}

export const collectMetricSchemasFromEvaluator = (
    evaluator: any,
): Array<{name: string; schema: any}> => {
    if (!evaluator || typeof evaluator !== "object") return []
    const map = new Map<string, any>()
    const register = (obj: any) => {
        if (!obj || typeof obj !== "object") return
        Object.entries(obj).forEach(([key, schema]) => {
            if (!map.has(key)) {
                map.set(key, schema)
            }
        })
    }

    register(evaluator?.metrics)
    register(evaluator?.data?.schemas?.outputs?.properties)
    register(evaluator?.data?.service?.format?.properties?.outputs?.properties)
    register(evaluator?.data?.service?.configuration?.format?.properties?.outputs?.properties)
    register(evaluator?.data?.configuration?.format?.properties?.outputs?.properties)
    register(evaluator?.data?.service?.format?.outputs?.properties)
    register(evaluator?.data?.service?.configuration?.outputs?.properties)
    register(evaluator?.data?.configuration?.outputs?.properties)

    return Array.from(map.entries()).map(([name, schema]) => ({name, schema}))
}

export const deriveSchemaMetricType = (schema: any): string | string[] | undefined => {
    if (!schema || typeof schema !== "object") return undefined
    const normalizeType = (value: unknown) => {
        if (!value) return undefined
        if (Array.isArray(value)) {
            const types = value
                .map((entry) =>
                    typeof entry === "string"
                        ? entry.toLowerCase()
                        : typeof entry?.type === "string"
                          ? entry.type.toLowerCase()
                          : undefined,
                )
                .filter(Boolean) as string[]
            if (types.length) return Array.from(new Set(types))
            return undefined
        }
        if (typeof value === "string") {
            return value.toLowerCase()
        }
        if (typeof value === "object" && value !== null) {
            return normalizeType((value as Record<string, unknown>).type)
        }
        return undefined
    }

    const primaryType = normalizeType(schema.type)
    if (primaryType) return primaryType

    const compositeKeys: Array<"anyOf" | "oneOf" | "allOf"> = ["anyOf", "oneOf", "allOf"]
    for (const key of compositeKeys) {
        if (Array.isArray(schema[key])) {
            const set = new Set<string>()
            schema[key].forEach((node: any) => {
                const type = deriveSchemaMetricType(node)
                if (!type) return
                if (Array.isArray(type)) type.forEach((entry) => set.add(entry))
                else set.add(type)
            })
            if (set.size) {
                const arr = Array.from(set)
                return arr.length === 1 ? arr[0] : arr
            }
        }
    }

    if (Array.isArray(schema.enum) && schema.enum.length) {
        if (schema.enum.every((value: unknown) => typeof value === "boolean")) return "boolean"
        if (schema.enum.every((value: unknown) => typeof value === "number")) return "number"
        if (schema.enum.every((value: unknown) => typeof value === "string")) return "string"
    }

    if (schema.items) {
        const itemType = deriveSchemaMetricType(schema.items)
        if (itemType) return itemType
        return "array"
    }

    return undefined
}
