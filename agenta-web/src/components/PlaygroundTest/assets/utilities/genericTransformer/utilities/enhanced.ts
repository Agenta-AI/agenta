import type {Enhanced} from "../types"

/** Enhanced property utilities */
export const getEnhancedProperties = (obj: Record<string, any> | undefined, exclude?: string[]) => {
    if (!obj) return []
    return Object.entries(obj)
        .filter(([key]) => !exclude?.includes(key))
        .reduce((acc, [_, value]) => {
            if (value && typeof value === "object" && "__id" in value) {
                acc.push(value)
            }
            return acc
        }, [] as Enhanced<unknown>[])
}
