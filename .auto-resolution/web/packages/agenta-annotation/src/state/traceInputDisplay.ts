function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isMeaningfulValue(value: unknown): boolean {
    if (value === null || value === undefined) return false
    if (typeof value === "string") return value.trim().length > 0
    if (Array.isArray(value)) return value.length > 0
    if (isRecord(value)) return Object.values(value).some(isMeaningfulValue)
    return true
}

function stableSerialize(value: unknown): string {
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

function isDuplicateNestedMessage({
    key,
    value,
    rootInputs,
}: {
    key: string
    value: unknown
    rootInputs: Record<string, unknown>
}) {
    const rootValue = rootInputs[key]
    return rootValue !== undefined && stableSerialize(rootValue) === stableSerialize(value)
}

export function getTraceInputDisplayValue(
    inputs: Record<string, unknown> | null | undefined,
    key: string,
): unknown {
    if (!inputs) return null

    const value = inputs[key]
    if (key !== "inputs" || !isRecord(value)) {
        return isMeaningfulValue(value) ? value : null
    }

    const residual = Object.entries(value).reduce<Record<string, unknown>>(
        (acc, [nestedKey, nestedValue]) => {
            if (
                isDuplicateNestedMessage({key: nestedKey, value: nestedValue, rootInputs: inputs})
            ) {
                return acc
            }

            if (isMeaningfulValue(nestedValue)) {
                acc[nestedKey] = nestedValue
            }

            return acc
        },
        {},
    )

    return Object.keys(residual).length > 0 ? residual : null
}

export function getTraceInputDisplayKeys(
    inputs: Record<string, unknown> | null | undefined,
): string[] {
    if (!inputs) return []

    return Object.keys(inputs).filter((key) => getTraceInputDisplayValue(inputs, key) !== null)
}
