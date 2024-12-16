import isEqual from "lodash/isEqual"
import type {InitialStateType, StateVariant, OpenAPISchema} from "../../../state/types"
import {accessKeyInVariant, parseVariantSchema} from "../../../assets/helpers"
import {type Variant} from "@/lib/Types"
import {dereference} from "@scalar/openapi-parser"
import {type OpenAPI} from "@scalar/openapi-types"

/**
 * FETCHERS
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

export const fetchAndUpdateVariants = async (variants: StateVariant[], service: string) => {
    const jsonPromises = variants.map((variant) => openAPIJsonFetcher(variant, service))

    const openapiJsons = await Promise.all(jsonPromises)

    openapiJsons.forEach((json) => {
        const stateVariant = variants.find((variant) => variant.variantId === json.variantId)
        if (!stateVariant) {
            console.error("Could not find variant for json", json)
            return
        }

        stateVariant.schema = parseVariantSchema(json.schema as OpenAPISchema)
    })

    return variants
}

/**
 * COMPARE FUNCTIONS
 */

export const findVariantById = (
    state: InitialStateType | undefined,
    variantId: string,
): StateVariant | undefined => state?.variants?.find((v) => v.variantId === variantId)

export const compareVariants = (
    variantsA: StateVariant[] = [],
    variantsB: StateVariant[] = [],
): boolean => {
    const keysA = variantsA.map((v) => v.variantId)
    const keysB = variantsB.map((v) => v.variantId)
    return keysA.length === keysB.length && keysA.every((key) => keysB.includes(key))
}

export const compareVariantConfig = (
    variantA: StateVariant | undefined,
    variantB: StateVariant | undefined,
    configKey: string,
    variantId: string,
): boolean => {
    if (!variantA || !variantB) return variantA === variantB

    const paramsA = accessKeyInVariant(configKey, variantA)
    const paramsB = accessKeyInVariant(configKey, variantB)

    return isEqual(paramsA, paramsB)
}

export const createBaseCompare = (
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
) => {
    return (a?: InitialStateType, b?: InitialStateType): boolean => {
        if (!a || !b) return false
        if (customCompare) return customCompare(a, b)
        return isEqual(a, b)
    }
}

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

export const compareVariant = (
    a: InitialStateType | undefined,
    b: InitialStateType | undefined,
    variantId: string,
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
    configKey?: string,
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

export const setVariants = (currentVariants: StateVariant[], newVariants: any[]) => {
    const areEqual = isEqual(currentVariants, newVariants)
    if (!areEqual) {
        return newVariants.map((variant) => {
            return {
                appId: variant.app_id,
                variantId: variant.variant_id,
                baseId: variant.base_id,
                baseName: variant.base_name,
                variantName: variant.variant_name,
                revision: variant.revision,
                configName: variant.config_name,
                projectId: variant.project_id,
                appName: variant.app_name,
            } as StateVariant
        })
    }
    return currentVariants
}
