import isEqual from "lodash/isEqual"
import type {
    InitialStateType,
    StateVariant,
    OpenAPISchema,
    GroupConfigReturn,
    PromptDefaults,
    ModelDefaults,
} from "../../../state/types"
import {accessKeyInVariant} from "../../../assets/helpers"
import {type Variant} from "@/lib/Types"
import {dereference} from "@scalar/openapi-parser"
import {type OpenAPI} from "@scalar/openapi-types"
import {getBodySchemaName} from "@/lib/helpers/openapi_parser"

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

export const groupConfigOptions = <R extends boolean = false, P extends boolean = false>({
    configObject,
    filterByName = (_: string) => true,
    reduce = false as R,
    configKeyRoot,
}: {
    configObject: Record<string, any>
    filterByName: (propertyName: string) => boolean
    reduce?: R
    configKeyRoot: string
}): GroupConfigReturn<R, P> => {
    const filtered = Object.keys(configObject).filter(filterByName)

    return (
        reduce
            ? filtered.reduce(
                  (acc, propertyName) => ({
                      ...acc,
                      [propertyName]: configObject[propertyName],
                      key: propertyName,
                  }),
                  {} as P extends true ? PromptDefaults : ModelDefaults,
              )
            : filtered.map((propertyName, index) => ({
                  ...(configObject[propertyName] || {}),
                  key: propertyName,
                  configKey: `${configKeyRoot}.[${index}]`,
              }))
    ) as GroupConfigReturn<R, P>
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

        const originalSchema = json.schema as OpenAPISchema
        const schemaName = originalSchema ? getBodySchemaName(originalSchema) : ""

        // TODO: refactor when we have multiple prompts
        // Extract our configuration that defines the shape of a
        // variant from openapi schema
        const agentaConfig =
            originalSchema.components.schemas[schemaName]?.properties?.agenta_config

        const configKeyRoot = `schema.promptConfig.[${0}]`
        const modelProperties = groupConfigOptions<false, false>({
            configObject: agentaConfig?.properties || {},
            filterByName: (propertyName) => !propertyName.includes("prompt_"),
            configKeyRoot: `${configKeyRoot}.modelProperties`,
        })
        const modelDefaults = groupConfigOptions<true, false>({
            configObject: agentaConfig?.default,
            filterByName: (propertyName) => !propertyName.includes("prompt_"),
            reduce: true,
            configKeyRoot: `${configKeyRoot}.configKeyRoot`,
        })

        const promptProperties = groupConfigOptions<false, false>({
            configObject: agentaConfig?.properties || {},
            filterByName: (propertyName) => propertyName.includes("prompt_"),
            configKeyRoot: `${configKeyRoot}.promptProperties`,
        })

        const promptDefaults = groupConfigOptions<true, true>({
            configObject: agentaConfig?.default,
            filterByName: (propertyName) => propertyName.includes("prompt_"),
            reduce: true,
            configKeyRoot: `${configKeyRoot}.promptDefaults`,
        })

        stateVariant.schema = {
            schemaName,
            promptConfig: [
                {
                    key: `${schemaName}-prompt-${0}`,
                    modelProperties,
                    modelDefaults,
                    promptProperties,
                    promptDefaults,
                },
            ],
        }
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
