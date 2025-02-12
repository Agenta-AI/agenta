import isEqual from "fast-deep-equal"
import {dereference} from "@scalar/openapi-parser"

import {transformToEnhancedVariant} from "../../../assets/utilities/transformer/transformer"
import {updateVariantPromptKeys, initializeVariantInputs} from "./inputHelpers"

import type {InitialStateType} from "../../../state/types"
import type {OpenAPISpec} from "../../../assets/utilities/genericTransformer/types"
import type {EnhancedVariant} from "../../../assets/utilities/transformer/types"
import {getJWT} from "@/services/api"
import {getCurrentProject} from "@/contexts/project.context"

/**
 * Recursively omit specified keys from an object
 */
export const omitDeep = (obj: any, keys: string[]): any => {
    if (!obj || typeof obj !== "object") return obj

    if (Array.isArray(obj)) {
        return obj.map((item) => omitDeep(item, keys))
    }

    return Object.entries(obj).reduce(
        (acc, [key, value]) => {
            if (keys.includes(key)) return acc

            acc[key] = typeof value === "object" ? omitDeep(value, keys) : value

            return acc
        },
        {} as Record<string, any>,
    )
}

export const isPlaygroundEqual = (a?: any, b?: any): boolean => {
    return isEqual(a, b)
}

export const uriFixer = (uri: string) => {
    if (!uri.includes("http://") && !uri.includes("https://")) {
        // for oss.agenta.ai
        uri = `https://${uri}`
    } else if (!uri.includes("/services/")) {
        uri = uri.replace("/chat", "/services/chat")
        uri = uri.replace("/completion", "/services/completion")
    }
    return uri
}

/**
 * FETCHERS
 */

/**
 * Fetches OpenAPI specification for a given variant from a service
 * @param variant - Variant object containing at least the variantId
 * @returns Promise containing variantId, parsed schema and any errors
 */
export const fetchOpenApiSchemaJson = async (uri: string) => {
    const jwt = await getJWT()
    const openapiJsonResponse = await fetch(
        `${uriFixer(uri)}/openapi.json${jwt ? `?project_id=${getCurrentProject().projectId}` : ""}`,
        {
            headers: {
                ...(jwt
                    ? {
                          Authorization: `Bearer ${jwt}`,
                      }
                    : {}),
            },
        },
    )
    const responseJson = await openapiJsonResponse.json()
    const {schema, errors} = await dereference(responseJson)

    return {
        schema: schema,
        errors,
    }
}

/**
 * Fetches and updates OpenAPI schema for a single variant
 * @param variant - The variant to fetch and update schema for
 * @returns Promise containing the updated variant
 */
export const transformVariant = (variant: EnhancedVariant, schema: OpenAPISpec) => {
    const enhancedVariant = transformToEnhancedVariant(variant, schema)

    // Update prompt keys and initialize inputs
    updateVariantPromptKeys(enhancedVariant)

    return enhancedVariant
}

/**
 * Fetches and updates OpenAPI schemas for multiple variants in parallel
 * @param variants - Array of variants to fetch and update schemas for
 * @returns Promise containing updated variants with their schemas
 */
export const transformVariants = (variants: EnhancedVariant[], spec: OpenAPISpec) => {
    return variants.map((variant) => transformVariant(variant, spec))
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

export const setVariant = (variant: any): EnhancedVariant => {
    // TEMPORARY FIX FOR PREVIOUSLY CREATED AGENTA_CONFIG
    // TODO: REMOVE THIS BEFORE RELEASE.
    if (variant.parameters.agenta_config) {
        variant.parameters.ag_config = variant.parameters.agenta_config
        delete variant.parameters.agenta_config
    }

    return {
        id: variant.variant_id,
        uri: uriFixer(variant.uri),
        appId: variant.app_id,
        baseId: variant.base_id,
        baseName: variant.base_name,
        variantName: variant.variant_name,
        templateVariantName: variant.template_variant_name,
        revision: variant.revision,
        configName: variant.config_name,
        projectId: variant.project_id,
        appName: variant.app_name,
        parameters: {
            agConfig: variant.parameters.ag_config || {},
        },
        isChat: false,
        inputs: {} as EnhancedVariant["inputs"],
        messages: {} as EnhancedVariant["messages"],
        name: "",
        updatedAt: variant.updated_at,
    } as EnhancedVariant
}

/**
 * Bulk transforms an array of raw variants into EnhancedVariant objects
 * Only updates if the new variants are different from current ones
 * @param currentVariants - Current array of EnhancedVariant objects
 * @param newVariants - New array of raw variant data
 * @returns Array of transformed EnhancedVariant objects or current variants if unchanged
 */
export const setVariants = (currentVariants: EnhancedVariant[], newVariants: any[]) => {
    const areEqual = isPlaygroundEqual(currentVariants, newVariants)
    if (!areEqual) {
        return newVariants.map(setVariant)
    }
    return currentVariants
}
