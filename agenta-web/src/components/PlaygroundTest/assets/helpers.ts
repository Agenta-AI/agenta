import {getBodySchemaName} from "@/lib/helpers/openapi_parser"
import type {
    ParsedSchema,
    ArrayType,
    OpenAPISchema,
    PromptConfigType,
    SchemaObject,
    PromptTemplate,
    AnyOfType,
    StringType,
    ModelConfig,
} from "../types"
import {AgentaConfig, ObjectType} from "../types"

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

/**
 * Sets a nested property in an object using a dot and bracket notation path.
 *
 * @param {string} path - The path to the property, e.g., "a.b.c.[0].e".
 * @param {Record<string, any>} object - The object to update.
 * @param {any} value - The value to set at the specified path.
 * @returns {Record<string, any>} - The updated object.
 */
export const setKeyInVariant = (
    path: string,
    object: Record<string, any>,
    value: any,
): Record<string, any> => {
    const keys = path.split(/[\.\[\]]/).filter(Boolean)
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

/**
 * Removes empty keys from an object.
 *
 * @param {T} obj - The object to clean.
 * @returns {T} - The cleaned object.
 */
const cleanEmptyKeys = <T extends Record<string, any>>(obj: T, promptDefault: any): T => {
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

/**
 * Extracts the configuration for a given property.
 *
 * @param {any} property - The property to extract the configuration from.
 * @param {string} parentKey - The parent key for the property.
 * @returns {any} - The extracted configuration.
 */
const extractConfig = (property: any, parentKey: string) => {
    if (property.type === "array" && property.items?.properties) {
        return property.items.properties
    }
    return property
}

/**
 * Processes a property and adds it to the accumulator.
 *
 * @param {Record<string, PromptConfigType>} acc - The accumulator to add the property to.
 * @param {string} key - The key of the property.
 * @param {any} property - The property to process.
 * @param {string} parentKey - The parent key for the property.
 * @param {PromptTemplate | undefined} promptDefault - The default prompt template.
 * @returns {Record<string, PromptConfigType>} - The updated accumulator.
 */
const processProperty = (
    acc: Record<string, PromptConfigType>,
    key: string,
    property: any,
    parentKey: string,
    promptDefault: PromptTemplate | undefined,
) => {
    const createConfigType = (config: Record<string, any>, configKey: string, type: string) => {
        const keyValue = promptDefault?.[key as keyof PromptTemplate]
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
            value: value as ArrayType | AnyOfType | StringType | ModelConfig | undefined,
            valueKey: `${parentKey.replace(".config", ".value")}`,
        }
    }

    const processInnerProperties = (properties: Record<string, any>, parentKey: string) => {
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
        const arrayProperty = property as ArrayType
        if (arrayProperty.items?.type === "object") {
            acc[key] = createConfigType(
                processInnerProperties(arrayProperty.items.properties || {}, parentKey),
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
            processInnerProperties((property as ObjectType).properties || {}, parentKey),
            `${parentKey}`,
            property.type,
        )
    } else {
        acc[key] = createConfigType(
            extractConfig(property, parentKey),
            `${parentKey}.config`,
            property.type,
        )
    }
    return acc
}

/**
 * Parses the variant schema from the OpenAPI schema.
 *
 * @param {OpenAPISchema} originalSchema - The original OpenAPI schema.
 * @returns {ParsedSchema} - The parsed variant schema.
 */
export const parseVariantSchema = (originalSchema: OpenAPISchema): ParsedSchema => {
    const schemaName: keyof OpenAPISchema["components"]["schemas"] | undefined = originalSchema
        ? (getBodySchemaName(originalSchema) as keyof OpenAPISchema["components"]["schemas"])
        : undefined

    if (!schemaName) {
        throw new Error("Could not find schema name in OpenAPI schema")
    }

    // Extract our configuration that defines the shape of a variant from openapi schema
    const agentaConfig =
        ((originalSchema.components.schemas[schemaName] as SchemaObject)?.properties
            ?.agenta_config as AgentaConfig) || {}

    console.log("agenta config", agentaConfig)

    const promptProperties = agentaConfig?.properties?.prompt?.properties
    const promptDefaults = Array.isArray(agentaConfig?.default?.prompt)
        ? agentaConfig?.default?.prompt
        : [agentaConfig?.default?.prompt]

    const promptSchemas = promptDefaults.map((promptDefault: PromptTemplate | undefined, index) => {
        const configTypes: Record<string, PromptConfigType> = Object.keys(
            promptProperties || {},
        ).reduce(
            (acc, key) => {
                const property = promptProperties?.[key as keyof typeof promptProperties]
                const parentKey = `schema.promptConfig.[${index}].${key}.config`

                if (property) {
                    processProperty(acc, key, property, parentKey, promptDefault)
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

    console.log("promptConfig", promptSchemas, JSON.stringify(promptSchemas, null, 2))

    return {
        schemaName,
        promptConfig: promptSchemas as {
            key: string
            messages: PromptConfigType
            llm_config: PromptConfigType
            template_format: PromptConfigType
            [key: string]: PromptConfigType | string
        }[],
    }
}
