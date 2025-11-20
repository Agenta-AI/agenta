import isEqual from "fast-deep-equal"
import Router from "next/router"

import {getAppValues} from "@/oss/contexts/app.context"
import {getCurrentProject} from "@/oss/contexts/project.context"
import {setVariant} from "@/oss/lib/shared/variant"

import type {EnhancedVariant} from "../../../../../lib/shared/variant/transformer/types"
import type {InitialStateType} from "../../../state/types"

export const isPlaygroundEqual = (a?: any, b?: any): boolean => {
    return isEqual(a, b)
}

export const getPlaygroundKey = (
    appId: string | undefined = getAppValues().currentApp?.app_id,
    projectId: string = getCurrentProject().projectId,
    path: string = Router.pathname.replaceAll("/", "_"),
) => {
    if (!appId) throw new Error("App ID is required for a valid playground key")
    return `/api/apps/${appId}/variants?project_id=${projectId}&v=2&path=${path}`
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

/**
 * Recursively searches the `history.value` array and its nested objects to find an item containing the specified ID.
 * @param state The state object or array to search.
 * @param targetId The ID to search for.
 * @returns The item in `history.value` that contains the nested object with the target ID, or `undefined` if not found.
 */
export const findItemInHistoryValueById = (state: any, targetId: string): any => {
    // Base case: If the state is not valid, return undefined
    if (!state || typeof state !== "object") return undefined

    // If the state is an array, iterate through its items
    if (Array.isArray(state)) {
        for (const item of state) {
            // Recursively search each item in the array
            const found = findItemInHistoryValueById(item, targetId)
            if (found) return found // Return the found item if it exists
        }
    } else {
        // If the state is an object, check if it has a `history.value` array
        if (state.history && Array.isArray(state.history.value)) {
            // Iterate through the `history.value` array
            for (const historyItem of state.history.value) {
                // Recursively search the history item and its nested objects
                const found = findNestedObjectById(historyItem, targetId)
                if (found) return historyItem // Return the parent history item if the target ID is found
            }
        }

        // Recursively search through all properties of the object
        for (const key in state) {
            if (state.hasOwnProperty(key)) {
                const value = state[key]
                if (typeof value === "object") {
                    const found = findItemInHistoryValueById(value, targetId) // Recursively search deeper
                    if (found) return found // Return the found item if it exists
                }
            }
        }
    }

    return undefined // Return undefined if no matching item is found
}

/**
 * Recursively searches a nested object for the specified ID.
 * @param obj The object to search.
 * @param targetId The ID to search for.
 * @returns The object containing the target ID, or `undefined` if not found.
 */
const findNestedObjectById = (obj: any, targetId: string): any => {
    // Base case: If the object is not valid, return undefined
    if (!obj || typeof obj !== "object") return undefined

    // Check if the current object has the target ID
    if (obj.__id === targetId) {
        return obj // Return the object if it matches the target ID
    }

    // Recursively search through all properties of the object
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const value = obj[key]
            if (typeof value === "object") {
                const found = findNestedObjectById(value, targetId) // Recursively search deeper
                if (found) return found // Return the found object if it exists
            }
        }
    }

    return undefined // Return undefined if no matching object is found
}

/**
 * Recursively finds the closest parent object with an `__id` that contains a nested object with the specified ID.
 * @param obj The object to search.
 * @param propertyId The ID to search for.
 * @returns The closest parent object with an `__id` that contains the target ID, or `undefined` if not found.
 */
export const findParentOfPropertyInObject = (obj: any, propertyId: string): any => {
    if (!obj || typeof obj !== "object") return undefined

    // Check if current object has the target ID directly (edge case)
    if (obj.__id === propertyId) return undefined // Target shouldn't return itself

    // Check if current object has a 'value' array containing the target
    if (Array.isArray(obj.value)) {
        for (const item of obj.value) {
            if (item?.__id === propertyId) {
                return obj.__id ? obj : undefined // Return parent if it has __id
            }
        }
    }

    // Recursively search all properties
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const value = obj[key]
            if (value && typeof value === "object") {
                const found = findParentOfPropertyInObject(value, propertyId)
                if (found) {
                    // Return the closest parent with __id
                    return found.__id ? found : obj.__id ? obj : undefined
                }
            }
        }
    }

    return undefined
}

// Update findPropertyInVariant to use the new utility
const findPropertyInVariant = (variant: EnhancedVariant, propertyId?: string) => {
    if (!propertyId || !variant) return undefined

    for (const prompt of variant.prompts || []) {
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

/**
 * Bulk transforms an array of raw variants into EnhancedVariant objects
 * Only updates if the new variants are different from current ones
 * @param currentVariants - Current array of EnhancedVariant objects
 * @param newVariants - New array of raw variant data
 * @returns Array of transformed EnhancedVariant objects or current variants if unchanged
 */
// TODO: DEPRECATE @ardaerzin
export const setVariants = (currentVariants: EnhancedVariant[], newVariants: any[]) => {
    const areEqual = isPlaygroundEqual(currentVariants, newVariants)
    if (!areEqual) {
        return newVariants.map(setVariant)
    }
    return currentVariants
}
