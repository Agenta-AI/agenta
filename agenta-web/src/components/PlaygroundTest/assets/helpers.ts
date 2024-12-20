import {detectChatVariantFromOpenAISchema, getBodySchemaName} from "@/lib/helpers/openapi_parser"
import {SchemaObject, WithConfig} from "../types/shared"
import {JoinPath, Path, PathValue} from "../types/pathHelpers"
import {StateVariant} from "../state/types"
import {OpenAPISpec} from "../types/openApiSpec"
import {
    AgentaConfig,
    AgentaPromptSchema,
    ParsedSchema,
    PromptConfigType,
    ArrayWithObjectConfig,
    RegularConfig,
    PropertySchema,
} from "../types/parsedSchema"
import {LLMConfig, Message} from "../types/openApiTypes"

// Path manipulation utilities
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
    const result = {...object}

    keys.reduce((o, i, idx) => {
        if (idx === keys.length - 1) {
            o[i] = value
        } else {
            if (o[i] === undefined) {
                o[i] = {}
            }
            return o[i]
        }
        return o
    }, result)

    return result
}

export function joinPath<T extends Path<StateVariant>, K extends string>(
    base: T,
    key: K,
): JoinPath<T, K> {
    if (!key) return base as JoinPath<T, K>
    return `${base}.${key}` as const as JoinPath<T, K>
}

// Schema processing utilities
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

const extractConfig = (property: SchemaObject, parentKey: string): SchemaObject => {
    // Don't extract properties from array items anymore
    return property
}

// Type guard for schema with Agenta config
function hasAgentaConfig(
    schema: OpenAPISpec["components"]["schemas"][keyof OpenAPISpec["components"]["schemas"]],
): schema is {
    properties: {
        agenta_config: AgentaConfig
        inputs: {title: "Inputs"}
    }
    type: "object"
    required: string[]
    title: string
} {
    return (
        typeof schema === "object" &&
        schema !== null &&
        "properties" in schema &&
        typeof schema.properties === "object" &&
        "agenta_config" in schema.properties
    )
}

// Property processing
const isArrayWithObjectConfig = (config: PromptConfigType): config is ArrayWithObjectConfig => {
    return config.type === "array" && config.subType === "object"
}

const processProperty = (
    acc: Record<string, ArrayWithObjectConfig | RegularConfig>,
    key: string,
    property: SchemaObject,
    parentKey: string,
    promptDefault: any,
): Record<string, ArrayWithObjectConfig | RegularConfig> => {
    const createConfigType = (
        config: SchemaObject,
        configKey: string,
        type: string,
        subType?: string,
    ): ArrayWithObjectConfig | RegularConfig => {
        const baseConfig = {
            key,
            type,
            configKey,
            valueKey: `${parentKey.replace(".config", ".value")}`,
            value: Array.isArray(promptDefault?.[key])
                ? promptDefault[key].map((val: any, index: number) => ({
                      ...val,
                      valueKey: `${parentKey.replace(".config", ".value")}.[${index}]`,
                  }))
                : promptDefault?.[key],
        }

        if (type === "array" && subType === "object") {
            return {
                ...baseConfig,
                type: "array",
                subType: "object",
                configKey: `${parentKey.replace(".config", ".objectConfig.properties")}`,
                objectConfig: {
                    ...config,
                    key,
                    type: "object",
                    properties: Object.entries(config.properties || {}).reduce(
                        (acc, [propKey, propValue]) => ({
                            ...acc,
                            [propKey]: {
                                ...propValue,
                                key: propKey,
                                configKey: `${parentKey}.${propKey}`,
                            },
                        }),
                        {} as Record<string, PropertySchema>,
                    ),
                },
            } as ArrayWithObjectConfig
        }

        return {
            ...baseConfig,
            config:
                type === "object"
                    ? config.properties
                    : Object.entries({[key]: config}).reduce(
                          (acc, [propKey, propValue]) => ({
                              ...acc,
                              [propKey]: {
                                  ...(typeof propValue === "object" ? propValue : {}),
                                  key: propKey,
                                  configKey: `${configKey}.${propKey}`,
                              },
                          }),
                          {} as Record<string, PropertySchema>,
                      ),
        } as RegularConfig
    }

    // Process properties based on type
    if (property.type === "array") {
        if (property.items?.type === "object") {
            acc[key] = createConfigType(
                property.items,
                `${parentKey}`,
                property.type,
                property.items.type,
            )
        } else {
            const extracted = extractConfig(property, parentKey)
            acc[key] = createConfigType(
                extracted,
                `${parentKey}`,
                property.type,
                property.items?.type,
            )
        }
    } else if (key === "llm_config") {
        acc[key] = createConfigType(property, `${parentKey}`, "object")
    } else {
        const extracted = extractConfig(property, parentKey)
        acc[key] = createConfigType(extracted, `${parentKey}`, property.type || "object")
    }

    return acc
}

// Main parser function
export const parseVariantSchema = (originalSchema: OpenAPISpec): ParsedSchema => {
    const schemaName = getBodySchemaName(
        originalSchema,
    ) as keyof OpenAPISpec["components"]["schemas"]
    const isChat = detectChatVariantFromOpenAISchema(originalSchema)

    if (!schemaName) {
        throw new Error("Could not find schema name in OpenAPI schema")
    }

    const schema = originalSchema.components.schemas[schemaName]

    if (!hasAgentaConfig(schema)) {
        throw new Error(`Schema ${schemaName} does not contain agenta_config`)
    }

    const agentaConfig = schema.properties.agenta_config
    const promptProperties = agentaConfig?.properties?.prompt
        ?.properties as AgentaPromptSchema["properties"]
    const promptDefaults = agentaConfig?.default?.prompt
        ? Array.isArray(agentaConfig?.default?.prompt)
            ? agentaConfig.default.prompt
            : [agentaConfig?.default?.prompt]
        : []

    const promptSchemas = promptDefaults.map((promptDefault, index) => {
        const configTypes: Record<string, ArrayWithObjectConfig | RegularConfig> = {}

        for (const key in promptProperties) {
            const property = promptProperties[key as keyof AgentaPromptSchema["properties"]]
            const parentKey = `schema.promptConfig.[${index}].${key}.config`

            if (property) {
                processProperty(configTypes, key, property, parentKey, promptDefault)
            }
        }

        return {
            key: `${schemaName}-prompt-${index}`,
            ...cleanEmptyKeys(configTypes, promptDefault),
        }
    })

    return {
        schemaName,
        isChat,
        promptConfig: promptSchemas as ParsedSchema["promptConfig"],
    }
}
