import type {
    BaseSchema,
    StringSchema,
    NumberSchema,
    BooleanSchema,
    ObjectSchema,
    ArraySchema,
    Nullable,
    EnumSchema,
    InferSchemaType,
} from "./shared"

// Application-specific types
type MessageRole = "system" | "user" | "assistant" | "tool" | "function"
type TemplateFormat = "fstring" | "jinja2" | "curly"
type ToolChoice = "none" | "auto"
type ResponseFormatType = "text" | "json_object" | "json_schema"

// Message and Tool Types
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
}

// Runtime types inferred from schemas
export interface Message extends InferSchemaType<MessageSchema> {}
export interface ToolCall extends InferSchemaType<ToolCallSchema> {}

// Response Format Types
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

export type ResponseFormat = InferSchemaType<ResponseFormatSchema>
export interface JSONSchema extends InferSchemaType<JSONSchemaProperties> {}

// LLM Configuration
interface LLMConfigSchema
    extends ObjectSchema<{
        model: StringSchema & {
            default: "gpt-3.5-turbo"
            description: "ID of the model to use"
        }
        temperature: Nullable<NumberSchema>
        max_tokens: Nullable<NumberSchema>
        top_p: Nullable<NumberSchema>
        frequency_penalty: Nullable<NumberSchema>
        presence_penalty: Nullable<NumberSchema>
        response_format: Nullable<ResponseFormatSchema>
        stream: Nullable<BooleanSchema>
        tools: Nullable<ArraySchema<ObjectSchema>>
        tool_choice: Nullable<EnumSchema<ToolChoice> | ObjectSchema>
    }> {
    title: "ModelConfig"
    description: "Configuration for the model parameters"
}

export interface LLMConfig extends InferSchemaType<LLMConfigSchema> {}

export type {
    MessageRole,
    TemplateFormat,
    ToolChoice,
    ResponseFormatType,
    MessageSchema,
    LLMConfigSchema,
    ToolCallSchema,
    ResponseFormatSchema,
    JSONSchemaProperties,
}
