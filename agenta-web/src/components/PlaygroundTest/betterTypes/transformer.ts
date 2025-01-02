/**
 * Main transformation logic for converting OpenAPI schemas to enhanced variants
 *
 * This module is responsible for:
 * - Converting OpenAPI schemas into runtime configurations
 * - Handling both chat and completion variants
 * - Maintaining type safety during transformations
 * - Creating properly structured prompt configurations
 */

import type {
    OpenAPISpec,
    ObjectSchema,
    AgentaConfigSchema,
    PlaygroundPromptSchema,
    SchemaProperty,
} from "./openApiSchema"
import type {BaseVariant, Enhanced, EnhancedVariant, ChatMessage} from "./types"
import {createEnhancedConfig} from "./transformers"
// import {isSchema} from "./utilities/schema"

/**
 * Type guard for PlaygroundPromptSchema
 */
function isPlaygroundPrompt(value: unknown): value is PlaygroundPromptSchema {
    if (!value || typeof value !== "object") return false

    const prompt = value as Partial<PlaygroundPromptSchema>
    return (
        "llmConfig" in prompt &&
        "messages" in prompt &&
        Array.isArray(prompt.messages) &&
        prompt.messages.every((msg) => typeof msg === "object" && "role" in msg && "content" in msg)
    )
}

/**
 * Transform raw prompt data into typed schema
 */
function validatePromptSchema(raw: Partial<PlaygroundPromptSchema>): PlaygroundPromptSchema {
    if (!isPlaygroundPrompt(raw)) {
        // Provide default values for required fields if missing
        const defaultPrompt: PlaygroundPromptSchema = {
            llmConfig: {
                model: "gpt-3.5-turbo",
            },
            messages: [],
            ...raw,
        }
        return defaultPrompt
    }
    return raw
}

/**
 * Transform prompt configuration using the new enhanced config system
 */
function transformPromptConfig(
    schema: ObjectSchema,
    defaults: PlaygroundPromptSchema,
): Enhanced<PlaygroundPromptSchema> {
    return createEnhancedConfig<PlaygroundPromptSchema>(defaults, schema)
}

/**
 * Process messages and inputs for the variant
 */
function processUserInteractables(
    properties: Record<string, SchemaProperty>,
    isChat: boolean,
): {
    inputs: Record<string, unknown>
    messages: Pick<ChatMessage, "role" | "content">[]
} {
    return {
        inputs: {},
        messages: isChat
            ? [
                  {
                      role: "system",
                      content: "You are an expert in geography",
                  },
                  {
                      role: "user",
                      content: "What is the capital of {country}?",
                  },
              ]
            : [],
    }
}

/**
 * Transform OpenAPI schema into an enhanced variant
 */
export function transformToEnhancedVariant(
    variant: BaseVariant,
    openApiSpec: OpenAPISpec,
): EnhancedVariant {
    const requestSchema =
        openApiSpec.paths["/playground/run"].post.requestBody.content["application/json"].schema

    if (!("properties" in requestSchema) || !requestSchema.properties) {
        throw new Error("Invalid OpenAPI schema: missing properties")
    }

    const agentaConfig = requestSchema.properties.agenta_config
    if (!agentaConfig || !("properties" in agentaConfig)) {
        throw new Error("Invalid schema: missing or invalid agenta_config")
    }

    // Type assertion after validation
    const typedConfig = agentaConfig as AgentaConfigSchema
    if (!typedConfig.properties?.prompt) {
        throw new Error("Invalid agenta_config schema: missing prompt properties")
    }

    // Now TypeScript knows all properties exist and are of correct type
    const promptData = validatePromptSchema(
        typedConfig.default.prompt as Partial<PlaygroundPromptSchema>,
    )

    return {
        ...variant,
        isChat: "properties" in requestSchema && "messages" in requestSchema.properties,
        prompts: [createEnhancedConfig(promptData, typedConfig.properties.prompt)],
        inputs: {},
        messages: {
            value: [],
            __id: "messages",
            __metadata: {
                title: "Messages",
                description: "Chat messages",
                type: "array",
                itemMetadata: {
                    title: "Message",
                    description: "A single",
                    type: "object",
                    properties: {
                        role: {
                            title: "Role",
                            description: "The role of the message sender",
                            type: "string",
                        },
                        content: {
                            title: "Content",
                            description: "The message content",
                            type: "string",
                        },
                    },
                },
            },
        },
    }
}
