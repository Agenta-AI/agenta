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

import type {OpenAPISpec, ObjectSchema} from "../genericTransformer/types"
import type {EnhancedVariant, BaseVariant, AgentaConfigSchema} from "./types"

function mergeWithSavedConfig(
    schema: ObjectSchema,
    variant: BaseVariant,
): AgentaConfigSchema["default"]["prompt"] {
    const defaultConfig = schema.default || {}
    const savedConfig = variant.parameters?.agConfig?.prompt

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
    variant: BaseVariant,
    openApiSpec: OpenAPISpec,
): EnhancedVariant {
    const requestSchema =
        openApiSpec.paths["/generate"]?.post?.requestBody?.content?.["application/json"]?.schema
    if (!requestSchema || !("properties" in requestSchema)) {
        throw new Error("Invalid OpenAPI schema")
    }

    const agConfig = requestSchema.properties?.ag_config as AgentaConfigSchema
    if (!agConfig?.properties?.prompt) {
        throw new Error("Invalid ag_config schema")
    }

    // Merge schema defaults with saved configuration
    const mergedPromptData = mergeWithSavedConfig(agConfig.properties.prompt, variant)

    // Type assertion after validation
    const typedConfig = agConfig as AgentaConfigSchema
    if (!typedConfig.properties?.prompt) {
        throw new Error("Invalid ag_config schema: missing prompt properties")
    }

    const isChat =
        !!requestSchema && !!requestSchema.properties && !!requestSchema.properties.messages

    const prompts = [createEnhancedConfig(mergedPromptData, agConfig.properties.prompt)]

    return {
        ...variant,
        isChat,
        isChatVariant: isChat,
        prompts: [createEnhancedConfig(mergedPromptData, agConfig.properties.prompt)],
        inputs: {} as EnhancedVariant["inputs"],
        messages: {} as EnhancedVariant["messages"],
    }
}
