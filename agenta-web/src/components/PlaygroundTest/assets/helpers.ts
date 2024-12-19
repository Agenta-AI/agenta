import {getBodySchemaName} from "@/lib/helpers/openapi_parser"
import type {
    OpenAPISpec,
    PromptConfigType,
    ParsedSchema,
    SchemaObject,
    PromptProperties,
    SchemaWithAgentaConfig,
} from "../types/openapi"
import {StateVariant} from "../state/types"
import {Path, PathValue} from "../types"

export function accessKeyInVariant<T extends Record<string, any>, P extends Path<T> & string>(
    path: P,
    object: T,
): PathValue<T, P> {
    return path
        .split(/[.\[\]]/)
        .filter(Boolean)
        .reduce((o: any, i) => {
            if (o === undefined || o === null) return undefined
            return o[i]
        }, object) as PathValue<T, P>
}

export const setKeyInVariant = (
    path: string,
    object: Record<string, any>,
    value: any,
): Record<string, any> => {
    const keys = path.split(/[.\[\]]/).filter(Boolean)
    keys.reduce((o, i, idx) => {
        if (idx === keys.length - 1) {
            o[i] = value
        } else {
            if (o[i] === undefined) {
                o[i] = {}
            }
            return o[i]
        }
    }, object)
    return object
}

const cleanEmptyKeys = <T extends Record<string, any>>(
    obj: T,
    promptDefault: Partial<Record<string, any>>,
): T => {
    return Object.entries(obj).reduce((acc, [key, value]) => {
        if (
            (promptDefault && promptDefault[key] !== undefined) ||
            (value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                value.default !== undefined)
        ) {
            return {...acc, [key]: value}
        }
        return acc
    }, {} as T)
}

const extractConfig = (property: SchemaObject, parentKey: string): any => {
    if (property.type === "array" && property.items?.properties) {
        return property.items.properties
    }
    return property
}

const processProperty = (
    acc: Record<string, PromptConfigType>,
    key: string,
    property: SchemaObject,
    parentKey: string,
    promptDefault: any,
): Record<string, PromptConfigType> => {
    const createConfigType = (
        config: Record<string, any>,
        configKey: string,
        type: string,
    ): PromptConfigType => {
        const keyValue = promptDefault?.[key]
        const value = Array.isArray(keyValue)
            ? keyValue.map((val, index) => ({
                  ...val,
                  valueKey: `${parentKey.replace(".config", ".value")}.[${index}]`,
              }))
            : keyValue

        return {
            key,
            config,
            configKey,
            type,
            value,
            valueKey: `${parentKey.replace(".config", ".value")}`,
        }
    }

    const processInnerProperties = (
        properties: Record<string, SchemaObject>,
        parentKey: string,
    ): Record<string, PromptConfigType> => {
        return Object.keys(properties || {}).reduce(
            (innerAcc, innerKey) => {
                const innerParentKey = `${parentKey}.${innerKey}`
                innerAcc[innerKey] = {
                    key: innerKey,
                    configKey: `${innerParentKey}`,
                    ...extractConfig(properties[innerKey], innerParentKey),
                }
                return innerAcc
            },
            {} as Record<string, PromptConfigType>,
        )
    }

    if (property.type === "array") {
        if (property.items?.type === "object") {
            acc[key] = createConfigType(
                processInnerProperties(property.items.properties || {}, parentKey),
                `${parentKey}`,
                property.type,
            )
        } else {
            acc[key] = createConfigType(
                extractConfig(property, parentKey),
                `${parentKey}`,
                property.type,
            )
        }
    } else if (property.type === "string") {
        acc[key] = createConfigType(
            extractConfig(property, parentKey),
            `${parentKey}`,
            property.type,
        )
    } else if (key === "llm_config") {
        acc[key] = createConfigType(
            processInnerProperties(property.properties || {}, parentKey),
            `${parentKey}`,
            property.type || "object",
        )
    } else {
        acc[key] = createConfigType(
            extractConfig(property, parentKey),
            `${parentKey}.config`,
            property.type || "object",
        )
    }
    return acc
}

function hasAgentaConfig(
    schema: OpenAPISpec["components"]["schemas"][keyof OpenAPISpec["components"]["schemas"]],
): schema is SchemaWithAgentaConfig {
    return (
        typeof schema === "object" &&
        schema !== null &&
        "properties" in schema &&
        typeof schema.properties === "object" &&
        "agenta_config" in schema.properties
    )
}

// Add these new types and helper function
type JoinPath<T extends string, K extends string> = `${T}.${K}`

export function joinPath<T extends Path<StateVariant>, K extends string>(
    base: T,
    key: K,
): JoinPath<T, K> {
    return `${base}.${key}` as const
}

// Type guard to check if a schema has properties
// function hasProperties(
//     schema: OpenAPISpec["components"]["schemas"][keyof OpenAPISpec["components"]["schemas"]],
// ): schema is {
//     properties: Record<string, any>
//     type: string
//     required?: string[]
//     title: string
// } {
//     return (
//         typeof schema === "object" &&
//         schema !== null &&
//         "properties" in schema &&
//         typeof schema.properties === "object"
//     )
// }

export const parseVariantSchema = (originalSchema: OpenAPISpec): ParsedSchema => {
    const schemaName = getBodySchemaName(
        originalSchema,
    ) as keyof OpenAPISpec["components"]["schemas"]

    if (!schemaName) {
        throw new Error("Could not find schema name in OpenAPI schema")
    }

    const schema = originalSchema.components.schemas[schemaName]

    if (!hasAgentaConfig(schema)) {
        throw new Error(`Schema ${schemaName} does not contain agenta_config`)
    }

    // Now TypeScript knows schema.properties.agenta_config exists and is of type AgentaConfig
    const agentaConfig = schema.properties.agenta_config || {}

    console.log("agentaConfig", JSON.stringify(agentaConfig.properties.prompt.properties, null, 2))

    const promptProperties = agentaConfig?.properties?.prompt?.properties
    const promptDefaults = Array.isArray(agentaConfig?.default?.prompt)
        ? agentaConfig?.default?.prompt
        : [agentaConfig?.default?.prompt]

    // const promptSchemas = promptDefaults.map((promptDefault: any, index) => {
    //     const configTypes: Record<string, PromptConfigType> = Object.keys(
    //         promptProperties || {},
    //     ).reduce(
    //         (acc, key) => {
    //             const property = promptProperties?.[key]
    //             const parentKey = `schema.promptConfig.[${index}].${key}.config`

    //             if (property) {
    //                 processProperty(acc, key, property, parentKey, promptDefault)
    //             }

    //             return acc
    //         },
    //         {} as Record<string, PromptConfigType>,
    //     )

    //     return {
    //         key: `${schemaName}-prompt-${index}`,
    //         ...cleanEmptyKeys(configTypes, promptDefault),
    //     }
    // })

    // Then modify the mapping block
    const promptSchemas = (promptDefaults || []).map((promptDefault: any, index) => {
        const configTypes: Record<string, PromptConfigType> = Object.keys(
            promptProperties || {},
        ).reduce(
            (acc, key) => {
                // Use type assertion to tell TypeScript that key is a valid keyof PromptProperties
                const property = promptProperties?.[key as keyof PromptProperties]
                const parentKey = `schema.promptConfig.[${index}].${key}.config`

                if (property) {
                    processProperty(acc, key, property as SchemaObject, parentKey, promptDefault)
                }

                return acc
            },
            {} as Record<string, PromptConfigType>,
        )

        return {
            key: `${schemaName}-prompt-${index}`,
            ...cleanEmptyKeys(configTypes, promptDefault),
        }
    })

    return {
        schemaName,
        promptConfig: promptSchemas as ParsedSchema["promptConfig"],
    }
}
