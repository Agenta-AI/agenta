export const parseNumericString = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return raw

    const parsed = Number(trimmed)
    return Number.isNaN(parsed) ? raw : parsed
}

export const coerceNumericValue = (value: FilterItem["value"]): Filter["value"] => {
    if (Array.isArray(value)) {
        return value.map((item) =>
            typeof item === "string"
                ? parseNumericString(item)
                : Array.isArray(item)
                  ? coerceNumericValue(item)
                  : typeof item === "object" && item !== null
                    ? coerceNumericValue(item as any)
                    : item,
        )
    }

    if (typeof value === "object" && value !== null) {
        return Object.entries(value).reduce<Record<string, any>>((acc, [key, val]) => {
            if (typeof val === "string") {
                acc[key] = parseNumericString(val)
            } else if (Array.isArray(val) || (typeof val === "object" && val !== null)) {
                acc[key] = coerceNumericValue(val as any)
            } else {
                acc[key] = val
            }

            return acc
        }, {})
    }

    if (typeof value === "string") {
        return parseNumericString(value)
    }

    return value
}
