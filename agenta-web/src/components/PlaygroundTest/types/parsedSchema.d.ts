import type {
    BaseSchema,
    ObjectSchema,
    ArraySchema,
    StringSchema,
    Nullable,
    EnumSchema,
} from "./shared"

import type {
    Message,
    LLMConfig,
    TemplateFormat,
    LLMConfigSchema,
    MessageSchema,
} from "./openApiTypes"

// Base configuration type
interface ConfigBase<T extends BaseSchema = BaseSchema> {
    key: string
    config: T
    configKey: string
    type: string
    value: InferSchemaType<T>
    valueKey: string
}

// Property Schema Types
export interface PropertySchema extends SchemaObject {
    key: string
    configKey: string
    title?: string
    description?: string
}

// Config Types for different scenarios
export interface ArrayWithObjectConfig<T extends ObjectSchema = ObjectSchema> {
    key: string
    type: "array"
    subType: "object"
    configKey: string
    valueKey: string
    value: Array<Record<string, any>>
    objectConfig: T & {
        key: string
        configKey: string
        properties: Record<string, PropertySchema>
    }
}

export interface RegularConfig<T extends ObjectSchema = ObjectSchema> {
    key: string
    type: string
    configKey: string
    valueKey: string
    value: any
    config: Record<string, PropertySchema>
}

// // Updated PromptConfigType to be a discriminated union
// type PromptConfigType = ArrayWithObjectConfig | RegularConfig

// Helper type to infer the correct config type
type InferConfig<T extends PromptConfigType> = T extends ArrayWithObjectConfig
    ? T["objectConfig"]["properties"]
    : T extends RegularConfig
      ? T["config"]
      : never

// Prompt Configuration Type
interface PromptConfigType<T extends ObjectSchema = ObjectSchema> extends ConfigBase<T> {
    config?: {
        [K in keyof T["properties"]]: T["properties"][K] & {
            key: string
            configKey: string
        }
    }
    objectConfig?: T & {
        key: string
        configKey: string
    }
    subType?: string // Add this line to store array element type
}

// Agenta Configuration Types
interface AgentaConfigSchema extends ObjectSchema {
    properties: {
        messages: ArraySchema<MessageSchema>
        system_prompt: Nullable<StringSchema>
        user_prompt: Nullable<StringSchema>
        template_format: EnumSchema<TemplateFormat>
        input_keys: Nullable<ArraySchema<StringSchema>>
        llm_config: LLMConfigSchema
    }
}

interface AgentaPromptSchema extends AgentaConfigSchema {
    default?: {
        messages: Message[]
        system_prompt: string
        user_prompt: string
        template_format: "fstring"
        llm_config: LLMConfig
    }
    type: "object"
    title: "PromptTemplate"
    description: "A template for generating prompts with formatting capabilities"
    "x-parameters"?: {
        prompt: string
    }
}

export interface AgentaConfig {
    default?: {
        prompt: {
            llm_config: LLMConfig
            messages: Message[]
            system_prompt: string
            template_format: TemplateFormat
            user_prompt: string
        }
    }
    properties: {
        prompt: AgentaPromptSchema
    }
    type: "object"
    title: "MyConfig"
}

// Parsed Schema Types
export interface ParsedSchema {
    schemaName: string // or keyof OpenAPISpec["components"]["schemas"] if you want to keep the reference
    isChat: boolean
    promptConfig: {
        key: string
        messages: PromptConfigType
        llm_config: PromptConfigType
        template_format: PromptConfigType
        [key: string]: PromptConfigType | string
    }[]
}

export interface ParsedPrompt extends AgentaConfigSchema {
    default: {
        messages: Message[]
        system_prompt: string
        user_prompt: string
        template_format: "fstring"
        llm_config: LLMConfig
    }
}

export type {
    PromptConfigType,
    AgentaConfigSchema,
    AgentaPromptSchema,
    Message,
    LLMConfig,
    TemplateFormat,
    LLMConfigSchema,
    MessageSchema,
}
