import isEqual from "lodash/isEqual"
import {dereference} from "@scalar/openapi-parser"
import {transformToEnhancedVariant} from "../../../betterTypes/transformer"
import {updateVariantPromptKeys, initializeVariantInputs} from "./inputHelpers"

import {type InitialStateType} from "../../../state/types"
import {type OpenAPISpec} from "../../../betterTypes/openApiSchema"
import {type EnhancedVariant} from "../../../betterTypes/types"

/**
 * FETCHERS
 */

/**
 * Fetches OpenAPI specification for a given variant from a service
 * @param variant - Variant object containing at least the variantId
 * @param service - Service endpoint to fetch OpenAPI spec from
 * @returns Promise containing variantId, parsed schema and any errors
 */
export const fetchOpenApiSchemaJson = async (service: string) => {
    const openapiJsonResponse = await fetch(`http://localhost/${service}/openapi.json`)
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
 * @param service - Service endpoint to fetch OpenAPI spec from
 * @returns Promise containing the updated variant
 */
export const fetchAndUpdateVariant = async (variant: EnhancedVariant, schema: OpenAPISpec) => {
    const enhancedVariant = transformToEnhancedVariant(variant, schema)

    // Update prompt keys and initialize inputs
    updateVariantPromptKeys(enhancedVariant)
    initializeVariantInputs(enhancedVariant)

    console.log("enhancedVariant", enhancedVariant, schema)
    return enhancedVariant
}

/**
 * Fetches and updates OpenAPI schemas for multiple variants in parallel
 * @param variants - Array of variants to fetch and update schemas for
 * @param service - Service endpoint to fetch OpenAPI specs from
 * @returns Promise containing updated variants with their schemas
 */
export const fetchAndUpdateVariants = async (variants: EnhancedVariant[], spec: OpenAPISpec) => {
    // const specFetcher = await openAPIJsonFetcher(service)
    const updatePromises = variants.map((variant) => fetchAndUpdateVariant(variant, spec))
    return await Promise.all(updatePromises)
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
        return isEqual(a, b)
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

            if (!!variantsA && !!variantsB && !isEqual(variantsA, variantsB)) {
                const keysA = variantsA.map((v) => v.id)
                const keysB = variantsB.map((v) => v.id)

                return keysA.length === keysB.length && keysA.every((key) => keysB.includes(key))
            }
            return isEqual(a, b)
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

            if (!!variantsA && !!variantsB && !isEqual(variantsA, variantsB)) {
                const keysA = variantsA.map((v) => v.id)
                const keysB = variantsB.map((v) => v.id)

                return isEqual(keysA, keysB)
            }
            return isEqual(a, b)
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

    return isEqual(propA?.value, propB?.value)
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

    if (!!variantA && !!variantB && !isEqual(variantA, variantB)) {
        if (propertyId) {
            return compareVariantProperty(variantA, variantB, propertyId)
        }
        return isEqual(variantA, variantB)
    } else if (!!variantA && !!variantB && isEqual(variantA, variantB)) {
        return true
    }
    return createBaseCompare(customCompare)(a, b)
}

/**
 * Transforms raw variant data into a structured EnhancedVariant object
 * Handles snake_case to camelCase conversion and proper typing
 * @param variant - Raw variant data from API
 * @returns Structured EnhancedVariant object
 */
export const setVariant = (variant: any): EnhancedVariant => {
    return {
        id: variant.variant_id,
        appId: variant.app_id,
        baseId: variant.base_id,
        baseName: variant.base_name,
        variantName: variant.variant_name,
        templateVariantName: variant.template_variant_name,
        revision: variant.revision,
        configName: variant.config_name,
        projectId: variant.project_id,
        appName: variant.app_name,
        parameters: variant.parameters,
        isChat: false,
        prompts: [] as EnhancedVariant["prompts"],
        inputs: {} as EnhancedVariant["inputs"],
        messages: {} as EnhancedVariant["messages"],
        name: "",
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
    const areEqual = isEqual(currentVariants, newVariants)
    if (!areEqual) {
        return newVariants.map(setVariant)
    }
    return currentVariants
}
