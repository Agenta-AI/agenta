import isEqual from "lodash/isEqual"
import {openapi, dereference} from "@scalar/openapi-parser"
import {accessKeyInVariant, parseVariantSchema} from "../../../assets/helpers"

import type {InitialStateType, StateVariant} from "../../../state/types"
import {type Variant} from "@/lib/Types"
import {type OpenAPI} from "@scalar/openapi-types"
import {type OpenAPISpec} from "../../..//types/openApiSpec"

/**
 * FETCHERS
 */

/**
 * Fetches OpenAPI specification for a given variant from a service
 * @param variant - Variant object containing at least the variantId
 * @param service - Service endpoint to fetch OpenAPI spec from
 * @returns Promise containing variantId, parsed schema and any errors
 */
export const openAPIJsonFetcher = async (variant: Pick<Variant, "variantId">, service: string) => {
    const openapiJsonResponse = await fetch(`http://localhost/${service}/openapi.json`)
    const responseJson = await openapiJsonResponse.json()
    const doc = responseJson as OpenAPI.Document

    const {schema, errors} = await dereference(doc)

    return {
        variantId: variant.variantId,
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
export const fetchAndUpdateVariant = async (variant: StateVariant, service: string) => {
    const json = await openAPIJsonFetcher(variant, service)
    if (json.schema) {
        variant.schema = parseVariantSchema(json.schema as OpenAPISpec)
    }
    return variant
}

/**
 * Fetches and updates OpenAPI schemas for multiple variants in parallel
 * @param variants - Array of variants to fetch and update schemas for
 * @param service - Service endpoint to fetch OpenAPI specs from
 * @returns Promise containing updated variants with their schemas
 */
export const fetchAndUpdateVariants = async (variants: StateVariant[], service: string) => {
    const updatePromises = variants.map((variant) => fetchAndUpdateVariant(variant, service))
    await Promise.all(updatePromises)
    return variants
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
): StateVariant | undefined => state?.variants?.find((v) => v.variantId === variantId)

/**
 * Compares two arrays of variants by their IDs
 * Used to determine if variant collections have the same members
 * @param variantsA - First array of variants
 * @param variantsB - Second array of variants
 * @returns boolean indicating if arrays contain the same variant IDs
 */
export const compareVariants = (
    variantsA: StateVariant[] = [],
    variantsB: StateVariant[] = [],
): boolean => {
    const keysA = variantsA.map((v) => v.variantId)
    const keysB = variantsB.map((v) => v.variantId)
    return keysA.length === keysB.length && keysA.every((key) => keysB.includes(key))
}

/**
 * Compares a specific configuration key between two variants
 * @param variantA - First variant
 * @param variantB - Second variant
 * @param configKey - Configuration key to compare
 * @param variantId - ID of the variant being compared
 * @returns boolean indicating if the config values are equal
 */
export const compareVariantConfig = (
    variantA: StateVariant | undefined,
    variantB: StateVariant | undefined,
    configKey: keyof StateVariant,
    variantId: string,
): boolean => {
    if (!variantA || !variantB) return variantA === variantB

    const paramsA = accessKeyInVariant(configKey, variantA)
    const paramsB = accessKeyInVariant(configKey, variantB)

    return isEqual(paramsA, paramsB)
}

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
export const createVariantCompare = (
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
) => {
    return (a?: InitialStateType, b?: InitialStateType): boolean => {
        const test = () => {
            const variantsA = a?.variants
            const variantsB = b?.variants

            if (!!variantsA && !!variantsB && !isEqual(variantsA, variantsB)) {
                const keysA = variantsA.map((v) => v.variantId)
                const keysB = variantsB.map((v) => v.variantId)

                return keysA.length === keysB.length && keysA.every((key) => keysB.includes(key))
            }
            return isEqual(a, b)
        }

        return customCompare ? customCompare(a, b) : test()
    }
}

/**
 * Compares specific variants within state objects
 * Can compare entire variants or specific config keys
 * @param a - First state object
 * @param b - Second state object
 * @param variantId - ID of the variant to compare
 * @param customCompare - Optional custom comparison function
 * @param configKey - Optional specific config key to compare
 * @returns boolean indicating if the variants are equal
 */
export const compareVariant = (
    a: InitialStateType | undefined,
    b: InitialStateType | undefined,
    variantId: string,
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
    configKey?: keyof StateVariant,
): boolean => {
    const variantA = findVariantById(a, variantId)
    const variantB = findVariantById(b, variantId)

    if (!!variantA && !!variantB && !isEqual(variantA, variantB)) {
        if (configKey) {
            return compareVariantConfig(variantA, variantB, configKey, variantId)
        }
        return isEqual(variantA, variantB)
    } else if (!!variantA && !!variantB && isEqual(variantA, variantB)) {
        return true
    }
    return createBaseCompare(customCompare)(a, b)
}

/**
 * Transforms raw variant data into a structured StateVariant object
 * Handles snake_case to camelCase conversion and proper typing
 * @param variant - Raw variant data from API
 * @returns Structured StateVariant object
 */
export const setVariant = (variant: any): StateVariant => {
    return {
        appId: variant.app_id,
        variantId: variant.variant_id,
        baseId: variant.base_id,
        baseName: variant.base_name,
        variantName: variant.variant_name,
        templateVariantName: variant.template_variant_name,
        revision: variant.revision,
        configName: variant.config_name,
        projectId: variant.project_id,
        appName: variant.app_name,
    } as StateVariant
}

/**
 * Bulk transforms an array of raw variants into StateVariant objects
 * Only updates if the new variants are different from current ones
 * @param currentVariants - Current array of StateVariant objects
 * @param newVariants - New array of raw variant data
 * @returns Array of transformed StateVariant objects or current variants if unchanged
 */
export const setVariants = (currentVariants: StateVariant[], newVariants: any[]) => {
    const areEqual = isEqual(currentVariants, newVariants)
    if (!areEqual) {
        return newVariants.map(setVariant)
    }
    return currentVariants
}
