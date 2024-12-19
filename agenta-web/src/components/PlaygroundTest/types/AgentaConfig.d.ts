// Base metadata interfaces
interface SchemaMetadata {
    title?: string
    description?: string
    deprecated?: boolean
    examples?: unknown[]
}

// Base schema interface that all types extend
interface BaseSchema extends SchemaMetadata {
    type: string
    default?: unknown
}

// Primitive type schemas
interface StringSchema extends BaseSchema {
    type: "string"
    default?: string
    minLength?: number
    maxLength?: number
    pattern?: string
    format?: string
    const?: string
}

interface NumberSchema extends BaseSchema {
    type: "number" | "integer"
    default?: number
    minimum?: number
    maximum?: number
    exclusiveMinimum?: number
    exclusiveMaximum?: number
    multipleOf?: number
}

interface BooleanSchema extends BaseSchema {
    type: "boolean"
    default?: boolean
}

// Complex type schemas
interface ArraySchema<T extends BaseSchema = BaseSchema> extends BaseSchema {
    type: "array"
    items: T
    default?: unknown[]
    minItems?: number
    maxItems?: number
    uniqueItems?: boolean
}

interface ObjectSchema<T = Record<string, BaseSchema>> extends BaseSchema {
    type: "object"
    properties: T
    default?: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean | BaseSchema
    minProperties?: number
    maxProperties?: number
}

// Composition schemas
interface AnyOfSchema<T = BaseSchema> extends SchemaMetadata {
    anyOf: T[]
    default?: unknown
}

interface EnumSchema<T = string> extends BaseSchema {
    type: "string" | "number"
    enum: T[]
    default?: T
}

// Nullable helper
type Nullable<T extends BaseSchema> = AnyOfSchema<T | {type: "null"}>

// Application-specific types
type MessageRole = "system" | "user" | "assistant" | "tool" | "function"
type TemplateFormat = "fstring" | "jinja2" | "curly"
type ToolChoice = "none" | "auto"
type ResponseFormatType = "text" | "json_object" | "json_schema"

// Specific schema implementations
interface ToolCallSchema extends ObjectSchema {
    properties: {
        id: StringSchema
        type: StringSchema & {
            const: "function"
            default: "function"
        }
        function: ObjectSchema & {
            additionalProperties: StringSchema
        }
    }
    required: ["id", "function"]
}

interface MessageSchema extends ObjectSchema {
    properties: {
        role: EnumSchema<MessageRole>
        content: Nullable<StringSchema>
        name: Nullable<StringSchema>
        tool_calls: Nullable<ArraySchema<ToolCallSchema>>
        tool_call_id: Nullable<StringSchema>
    }
    required: ["role"]
    default?: {
        role: MessageRole
        content: string
    }
}

interface JSONSchemaProperties extends ObjectSchema {
    properties: {
        name: StringSchema
        description: Nullable<StringSchema>
        schema: Nullable<ObjectSchema>
        strict: Nullable<BooleanSchema>
    }
    required: ["name", "schema"]
}

interface ResponseFormatSchema extends ObjectSchema {
    properties: {
        type: EnumSchema<ResponseFormatType>
        json_schema?: JSONSchemaProperties
    }
    required: ["type"]
}

interface LLMConfigSchema
    extends ObjectSchema<{
        model: StringSchema & {
            default: "gpt-3.5-turbo"
            description: "ID of the model to use"
        }
        temperature: Nullable<NumberSchema> & {
            description: "What sampling temperature to use, between 0 and 2"
            default?: number
        }
        max_tokens: Nullable<NumberSchema> & {
            description: "The maximum number of tokens that can be generated"
            default?: number
        }
        top_p: Nullable<NumberSchema> & {
            description: "Alternative to sampling with temperature"
            default?: number
        }
        frequency_penalty: Nullable<NumberSchema> & {
            description: "Frequency penalty for token generation"
            default?: number
        }
        presence_penalty: Nullable<NumberSchema> & {
            description: "Presence penalty for token generation"
            default?: number
        }
        response_format: Nullable<ResponseFormatSchema>
        stream: Nullable<BooleanSchema>
        tools: Nullable<ArraySchema<ObjectSchema>>
        tool_choice: Nullable<EnumSchema<ToolChoice> | ObjectSchema>
    }> {
    title: "ModelConfig"
    description: "Configuration for the model parameters"
}

interface MessagesSchema extends ArraySchema<MessageSchema> {
    default: Array<{
        role: Extract<MessageRole, "system" | "user">
        content: string
    }>
}

export interface AgentaConfigSchema extends ObjectSchema {
    properties: {
        messages: MessagesSchema
        system_prompt: Nullable<StringSchema>
        user_prompt: Nullable<StringSchema>
        template_format: EnumSchema<TemplateFormat> & {
            description: "Format type for template variables: fstring {var}, jinja2 {{ var }}, or curly {{var}}"
            default: "fstring"
        }
        input_keys: Nullable<ArraySchema<StringSchema>> & {
            description: "Optional list of input keys for validation"
        }
        llm_config: LLMConfigSchema
    }
}

export type {
    // Base types
    SchemaMetadata,
    BaseSchema,
    StringSchema,
    NumberSchema,
    BooleanSchema,
    ArraySchema,
    ObjectSchema,
    AnyOfSchema,
    EnumSchema,
    Nullable,

    // Application-specific types
    MessageRole,
    TemplateFormat,
    ToolChoice,
    ResponseFormatType,
    MessageSchema,
    LLMConfigSchema,
    MessagesSchema,
    ToolCallSchema,
    ResponseFormatSchema,
    JSONSchemaProperties,
}
