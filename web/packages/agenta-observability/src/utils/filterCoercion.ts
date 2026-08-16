import type {Filter, FilterValue} from "../core/types"

export const parseNumericString = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return raw

    const parsed = Number(trimmed)
    return Number.isNaN(parsed) ? raw : parsed
}

export const coerceNumericValue = (value: FilterValue): Filter["value"] => {
    if (Array.isArray(value)) {
        return value.map((item) =>
            typeof item === "string"
                ? parseNumericString(item)
                : Array.isArray(item)
                  ? coerceNumericValue(item)
                  : typeof item === "object" && item !== null
                    ? coerceNumericValue(item as FilterValue)
                    : item,
        ) as Filter["value"]
    }

    if (typeof value === "object" && value !== null) {
        return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, val]) => {
            if (typeof val === "string") {
                acc[key] = parseNumericString(val)
            } else if (Array.isArray(val) || (typeof val === "object" && val !== null)) {
                acc[key] = coerceNumericValue(val as FilterValue)
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
