import isEqual from "fast-deep-equal"

// import {
//     initializeVariantInputs,
//     updateVariantPromptKeys,
// } from "@/oss/lib/shared/variant/inputHelpers"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

import type {InitialStateType} from "../state/types"

export const isPlaygroundEqual = (a?: any, b?: any): boolean => {
    return isEqual(a, b)
}

/**
 * COMPARE FUNCTIONS
 */

/**
 * Finds a variant by its ID in the application state
 * @param state - Current application state
 * @param variantId - ID of the variant to find
 * @returns The found variant or undefined
 */
export const findVariantById = (
    state: InitialStateType | undefined,
    variantId: string,
): EnhancedVariant | undefined => state?.variants?.find((v) => v.id === variantId)

/**
 * Creates a comparison function for base state objects
 * Falls back to deep equality if no custom compare function provided
 * @param customCompare - Optional custom comparison function
 * @returns Function that compares two state objects
 */
export const createBaseCompare = (
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
) => {
    return (a?: InitialStateType, b?: InitialStateType): boolean => {
        if (!a || !b) return false
        if (customCompare) return customCompare(a, b)
        return isPlaygroundEqual(a, b)
    }
}

/**
 * Creates a comparison function specifically for variant states
 * Compares variants by their IDs and falls back to deep equality
 * @param customCompare - Optional custom comparison function
 * @returns Function that compares two variant states
 */
export const createVariantsCompare = (
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
) => {
    return (a?: InitialStateType, b?: InitialStateType): boolean => {
        const test = () => {
            const variantsA = a?.variants
            const variantsB = b?.variants

            if (!!variantsA && !!variantsB && !isPlaygroundEqual(variantsA, variantsB)) {
                const keysA = variantsA.map((v) => v.id)
                const keysB = variantsB.map((v) => v.id)

                return keysA.length === keysB.length && keysA.every((key) => keysB.includes(key))
            }
            return isPlaygroundEqual(a, b)
        }

        return customCompare ? customCompare(a, b) : test()
    }
}

/**
 * Creates a comparison function specifically for variant states
 * Compares variants by their IDs and falls back to deep equality
 * @param customCompare - Optional custom comparison function
 * @returns Function that compares two variant states
 */
export const createVariantCompare = (
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
) => {
    return (a?: InitialStateType, b?: InitialStateType): boolean => {
        const test = () => {
            const variantsA = a?.variants
            const variantsB = b?.variants

            if (!!variantsA && !!variantsB && !isPlaygroundEqual(variantsA, variantsB)) {
                const keysA = variantsA.map((v) => v.id)
                const keysB = variantsB.map((v) => v.id)

                return isPlaygroundEqual(keysA, keysB)
            }
            return isPlaygroundEqual(a, b)
        }

        return customCompare ? customCompare(a, b) : test()
    }
}

/** Recursively finds a property in an object by its ID */
export const findPropertyInObject = (obj: any, propertyId: string): any => {
    if (!obj || typeof obj !== "object") return undefined

    // Check if current object has __id
    if ("__id" in obj && obj.__id === propertyId) {
        return obj
    }

    // Recursively search through object properties
    for (const key in obj) {
        const value = obj[key]
        if (typeof value === "object") {
            const found = findPropertyInObject(value, propertyId)
            if (found) return found
        }
    }

    return undefined
}

// Update findPropertyInVariant to use the new utility
const findPropertyInVariant = (variant: EnhancedVariant, propertyId?: string) => {
    if (!propertyId || !variant) return undefined

    for (const prompt of variant.prompts) {
        const found = findPropertyInObject(prompt, propertyId)
        if (found) return found
    }
    return undefined
}

/**
 * Compares two variants based on a specific property
 */
export const compareVariantProperty = (
    variantA: EnhancedVariant | undefined,
    variantB: EnhancedVariant | undefined,
    propertyId: string,
): boolean => {
    if (!variantA || !variantB) return variantA === variantB

    const propA = findPropertyInVariant(variantA, propertyId)
    const propB = findPropertyInVariant(variantB, propertyId)

    return isPlaygroundEqual(propA?.value, propB?.value)
}

/**
 * Compares specific variants within state objects
 */
export const compareVariant = (
    a: InitialStateType | undefined,
    b: InitialStateType | undefined,
    variantId: string,
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
    propertyId?: string,
): boolean => {
    const variantA = findVariantById(a, variantId)
    const variantB = findVariantById(b, variantId)

    const variantsEqual = isPlaygroundEqual(variantA, variantB)
    if (!!variantA && !!variantB && !variantsEqual) {
        if (propertyId) {
            return compareVariantProperty(variantA, variantB, propertyId)
        }
        return variantsEqual
    } else if (!!variantA && !!variantB && variantsEqual) {
        return true
    }
    return createBaseCompare(customCompare)(a, b)
}
