/**
 * Main transformation logic for converting OpenAPI schemas to enhanced variants
 *
 * This module is responsible for:
 * - Converting OpenAPI schemas into runtime configurations
 * - Handling both chat and completion variants
 * - Maintaining type safety during transformations
 * - Creating properly structured prompt configurations
 */

import {createEnhancedConfig, mergeWithSchema} from "../genericTransformer"
import type {
    OpenAPISpec,
    ObjectSchema,
    Enhanced,
    EnhancedObjectConfig,
} from "../genericTransformer/types"
import {constructPlaygroundTestUrl} from "../stringUtils"

import type {EnhancedVariant, BaseVariant, AgentaConfigSchema, AgentaConfigPrompt} from "./types"

function mergeWithSavedConfig(
    schema: ObjectSchema,
    variant: BaseVariant,
): AgentaConfigSchema["default"]["prompt"] {
    // TODO: FIX THIS TYPE
    const defaultConfig = schema.default || {}
    const savedConfig = schema.key
        ? variant.parameters?.agConfig?.[schema.key] ||
          variant.parameters?.ag_config?.[schema.key] ||
          variant.parameters?.[schema.key] ||
          variant.config?.parameters?.[schema.key]
        : undefined

    // Validate and convert saved config to match AgentaConfigSchema["default"]["prompt"]
    const validatedConfig = savedConfig
        ? {
              ...savedConfig,
          }
        : undefined

    return mergeWithSchema<AgentaConfigSchema["default"]["prompt"]>(
        schema,
        defaultConfig,
        validatedConfig,
        ["input_keys", "system_prompt", "user_prompt"],
    )
}

/**
 * Transform OpenAPI schema into an enhanced variant
 */
export function transformToEnhancedVariant(
    variant: EnhancedVariant,
    openApiSpec: OpenAPISpec,
    appType?: string,
    routePath?: string,
): EnhancedVariant {
    try {
        if (variant.parameters) {
            variant.parameters = variant.parameters.ag_config || variant.parameters
        }

        const path = constructPlaygroundTestUrl(
            variant.uriObject || {
                routePath,
            },
            undefined,
            false,
        )
        const requestSchema =
            openApiSpec?.paths?.[`${path}`]?.post?.requestBody?.content?.["application/json"]
                ?.schema

        if (!requestSchema || !("properties" in requestSchema)) {
            console.error("Invalid OpenAPI schema 2")
        }

        const agConfig = requestSchema?.properties?.ag_config as AgentaConfigSchema

        const properties = agConfig?.properties || {}

        const prompts = Object.keys(properties)
            .map((key) => {
                const property = properties[key]
                return property.hasOwnProperty("x-parameters") &&
                    typeof property["x-parameters"] === "object" &&
                    property["x-parameters"]?.prompt
                    ? {...property, key}
                    : null
            })
            .filter(Boolean) as ObjectSchema[]

        // Merge schema defaults with saved configuration
        const mergedPromptData = prompts.reduce(
            (acc, cur) => {
                if (!cur || !cur?.key) return acc

                const key = cur.key
                acc[key] = mergeWithSavedConfig(cur, variant)
                return acc
            },
            {} as Record<string, AgentaConfigPrompt>,
        )

        const isChat =
            !!requestSchema && !!requestSchema?.properties && !!requestSchema?.properties.messages

        const transformedPrompts = prompts
            .map((prompt) => {
                if (!prompt || !prompt.key) return null
                const transformed = createEnhancedConfig(mergedPromptData[prompt.key], prompt)
                return {
                    ...transformed,
                    __name: prompt?.key,
                }
            })
            .filter(Boolean) as EnhancedObjectConfig<AgentaConfigPrompt>[]

        const promptKeys = prompts.map((prompt) => prompt?.key)
        const customPropertyKeys = Object.keys(properties).filter((property) => {
            return !!property && !promptKeys.includes(property)
        })

        const customProperties = customPropertyKeys.reduce(
            (acc, key) => {
                const savedValue = (variant.parameters?.agConfig ||
                    variant.parameters?.ag_config ||
                    variant.parameters ||
                    variant.config?.parameters ||
                    {})?.[key] as any

                acc[key] = createEnhancedConfig(
                    savedValue || agConfig.default[key] || "",
                    properties[key],
                    key,
                )
                return acc
            },
            {} as Record<string, Enhanced<any>>,
        )

        const isCustom =
            appType === "custom" || (customProperties && Object.keys(customProperties).length > 0)

        return {
            ...variant,
            isChat,
            isCustom,
            prompts: transformedPrompts,
            customProperties,
            // @ts-ignore
            isStatelessVariant: true,
            // @ts-ignore
            isChatVariant: isChat,
            // @ts-ignore
            isCustom,
            // @ts-ignore
            inputs: {} as EnhancedVariant["inputs"],
            // @ts-ignore
            messages: {} as EnhancedVariant["messages"],
            // NEW
            requestSchema: {
                required: requestSchema?.required,
                title: requestSchema?.title,
                type: requestSchema?.type,
            },
        }
    } catch (err) {
        console.error("Error transforming variant:", err)
        throw err
    }
}
