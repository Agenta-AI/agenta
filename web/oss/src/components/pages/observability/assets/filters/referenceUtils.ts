import type {FilterValue} from "@/oss/lib/Types"

type ReferenceCategory =
    | "reference"
    | "application"
    | "evaluator"
    | "application_variant"
    | "environment"

const REFERENCE_KEY_PREFIX_MAP: Record<Exclude<ReferenceCategory, "reference">, string> = {
    application: "application",
    evaluator: "evaluator",
    application_variant: "application_variant",
    environment: "environment",
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const coerceArray = <T>(value: T | T[] | undefined | null): T[] => {
    if (Array.isArray(value)) return value
    if (value === undefined || value === null) return []
    return [value]
}

const detectCategoryFromValue = (entry: Record<string, unknown>): ReferenceCategory => {
    const attrKey = entry["attributes.key"]
    if (typeof attrKey === "string" && attrKey in REFERENCE_KEY_PREFIX_MAP) {
        return attrKey as ReferenceCategory
    }
    const category = entry.category
    if (typeof category === "string" && category in REFERENCE_KEY_PREFIX_MAP) {
        return category as ReferenceCategory
    }
    return "reference"
}

const detectPropertyFromValue = (entry: Record<string, unknown>): string => {
    if (entry.version !== undefined && entry.version !== null) return "version"
    if (entry.slug !== undefined && entry.slug !== null) return "slug"
    if (entry.id !== undefined && entry.id !== null) return "id"
    return "id"
}

export const parseReferenceKey = (
    rawKey?: string,
    rawValue?: any,
): {category: ReferenceCategory; property: string} => {
    if (typeof rawKey === "string" && rawKey.trim() !== "") {
        const [categoryPart, propertyPart] = rawKey.split(".")
        if (propertyPart && categoryPart in REFERENCE_KEY_PREFIX_MAP) {
            return {
                category: categoryPart as ReferenceCategory,
                property: propertyPart,
            }
        }
        if (categoryPart === "reference" && propertyPart) {
            return {category: "reference", property: propertyPart}
        }
        if (!propertyPart) {
            return {category: "reference", property: categoryPart}
        }
    }

    const candidates = coerceArray(rawValue)

    for (const candidate of candidates) {
        if (!isRecord(candidate)) continue
        const category = detectCategoryFromValue(candidate)
        const property = detectPropertyFromValue(candidate)
        return {category, property}
    }

    return {category: "reference", property: "id"}
}

export const normalizeReferenceValue = (
    rawValue: FilterValue,
    property: string,
    category: ReferenceCategory,
): Record<string, string>[] => {
    const extras =
        category === "reference"
            ? undefined
            : ({
                  "attributes.key":
                      REFERENCE_KEY_PREFIX_MAP[category as Exclude<ReferenceCategory, "reference">],
              } as Record<string, string>)

    return coerceArray(rawValue)
        .map((entry) => {
            if (isRecord(entry)) {
                const next: Record<string, string> = {}
                Object.entries(entry).forEach(([key, val]) => {
                    if (val === undefined || val === null) return
                    next[key] = typeof val === "string" ? val : String(val)
                })
                const value = next[property]
                if (!value || value.trim() === "") return undefined
                next[property] = value.trim()
                if (extras) next["attributes.key"] = extras["attributes.key"]
                else if (category === "reference") delete next["attributes.key"]
                return next
            }

            const str = entry === undefined || entry === null ? "" : String(entry).trim()
            if (!str) return undefined
            return {
                [property]: str,
                ...(extras ?? {}),
            }
        })
        .filter((item): item is Record<string, string> => Boolean(item))
}

export const inferReferenceOptionKey = (
    rawValue: FilterValue,
    rawKey?: string,
): string | undefined => {
    const {category, property} = parseReferenceKey(rawKey, rawValue)
    if (!property) return undefined
    if (category === "reference") return property
    const prefix = REFERENCE_KEY_PREFIX_MAP[category as Exclude<ReferenceCategory, "reference">]
    return property ? `${prefix}.${property}` : prefix
}
