import {getBodySchemaName} from "@/lib/helpers/openapi_parser"
import type {OpenAPISchema, GroupConfigReturn, PromptDefaults, ModelDefaults} from "../state/types"

/**
 * Accesses a nested property in an object using a dot and bracket notation path.
 *
 * @param {string} path - The path to the property, e.g., "a.b.c.[0].e".
 * @param {Record<string, any>} object - The object to access.
 * @returns {any} - The value at the specified path, or undefined if the path is invalid.
 */
export const accessKeyInVariant = (path: string, object: Record<string, any>): any => {
    return path
        .split(/[\.\[\]]/)
        .filter(Boolean)
        .reduce((o, i) => {
            if (o === undefined || o === null) return undefined
            return o[i]
        }, object)
}

export const groupConfigOptions = <R extends boolean = false, P extends boolean = false>({
    configObject,
    filterByName = (_: string) => true,
    reduce = false as R,
    configKeyRoot,
    parse = () => undefined,
}: {
    configObject: Record<string, any>
    filterByName: (propertyName: string) => boolean
    reduce?: R
    configKeyRoot: string
    parse?: (defaultType: {key: string; value: any}) => Record<string, any> | undefined
}): GroupConfigReturn<R, P> => {
    const filtered = Object.keys(configObject).filter(filterByName)

    return (
        reduce
            ? filtered.map((propertyName, index) => {
                  const obj = {
                      key: propertyName,
                      value: configObject[propertyName],
                      configKey: `${configKeyRoot}.[${index}]`,
                  }

                  return parse(obj) || obj
              })
            : filtered.map((propertyName, index) => ({
                  ...(configObject[propertyName] || {}),
                  key: propertyName,
                  configKey: `${configKeyRoot}.[${index}]`,
              }))
    ) as GroupConfigReturn<R, P>
}

/**
 * Parses the variant schema from the OpenAPI schema.
 *
 * @param {OpenAPISchema} originalSchema - The original OpenAPI schema.
 * @returns {any} - The parsed variant schema.
 */
export const parseVariantSchema = (originalSchema: OpenAPISchema) => {
    const schemaName = originalSchema ? getBodySchemaName(originalSchema) : ""

    // TODO: refactor when we have multiple prompts
    // Extract our configuration that defines the shape of a
    // variant from openapi schema
    const agentaConfig = originalSchema.components.schemas[schemaName]?.properties?.agenta_config

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
        configKeyRoot: `${configKeyRoot}.modelDefaults`,
        parse: (defaults) => {
            const properties = agentaConfig?.properties?.[defaults.key]
            return {
                ...defaults,
                config: {
                    ...properties,
                    key: defaults.key,
                },
                value: defaults.value || properties?.default,
            }
        },
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
        parse: (defaults) => {
            const properties = agentaConfig?.properties?.[defaults.key]
            return {
                ...defaults,
                config: {
                    ...properties,
                    key: defaults.key,
                },
                value: defaults.value || properties?.default,
            }
        },
    })

    console.log("promptDefaults", promptDefaults)

    return {
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
}
