import {
    AgentaConfigSchema,
    ArraySchema,
    EnumSchema,
    LLMConfigSchema,
    MessagesSchema,
    Nullable,
    StringSchema,
    TemplateFormat,
} from "./AgentaConfig"

export interface OpenAPISpec {
    openapi: string
    info: {
        title: string
        version: string
    }
    paths: {
        "/health": {
            get: {
                summary: "Health"
                operationId: "health_health_get"
                responses: {
                    "200": {
                        description: "Successful Response"
                        content: {
                            "application/json": {
                                schema: {}
                            }
                        }
                    }
                }
            }
        }
        "/run": {
            post: {
                summary: "Generate"
                operationId: "generate_run_post"
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                properties: {
                                    inputs: {
                                        title: "Inputs"
                                    }
                                }
                                type: "object"
                                required: ["inputs"]
                                title: "Body_generate_run_post"
                            }
                        }
                    }
                    required: true
                }
                responses: {
                    "200": {
                        description: "Successful Response"
                        content: {
                            "application/json": {
                                schema: BaseResponse
                            }
                        }
                    }
                    "422": ValidationErrorResponse
                }
            }
        }
        "/generate_deployed": {
            post: {
                summary: "Generate"
                operationId: "generate_generate_deployed_post"
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                properties: {
                                    inputs: {
                                        title: "Inputs"
                                    }
                                }
                                type: "object"
                                required: ["inputs"]
                                title: "Body_generate_generate_deployed_post"
                            }
                        }
                    }
                    required: true
                }
                responses: {
                    "200": {
                        description: "Successful Response"
                        content: {
                            "application/json": {
                                schema: BaseResponse
                            }
                        }
                    }
                    "422": ValidationErrorResponse
                }
            }
        }
        "/test": {
            post: {
                summary: "Generate"
                operationId: "generate_test_post"
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                properties: {
                                    agenta_config: AgentaConfig
                                    inputs: {
                                        title: "Inputs"
                                    }
                                }
                                type: "object"
                                required: ["inputs"]
                                title: "Body_generate_test_post"
                            }
                        }
                    }
                    required: true
                }
                responses: {
                    "200": {
                        description: "Successful Response"
                        content: {
                            "application/json": {
                                schema: BaseResponse
                            }
                        }
                    }
                    "422": ValidationErrorResponse
                }
            }
        }
        "/generate": {
            post: {
                summary: "Generate"
                operationId: "generate_generate_post"
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                properties: {
                                    agenta_config: AgentaConfig
                                    inputs: {
                                        title: "Inputs"
                                    }
                                }
                                type: "object"
                                required: ["inputs"]
                                title: "Body_generate_generate_post"
                            }
                        }
                    }
                    required: true
                }
                responses: {
                    "200": {
                        description: "Successful Response"
                        content: {
                            "application/json": {
                                schema: BaseResponse
                            }
                        }
                    }
                    "422": ValidationErrorResponse
                }
            }
        }
        "/playground/run": {
            post: {
                summary: "Generate"
                operationId: "generate_playground_run_post"
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                properties: {
                                    agenta_config: AgentaConfig
                                    inputs: {
                                        title: "Inputs"
                                    }
                                }
                                type: "object"
                                required: ["inputs"]
                                title: "Body_generate_playground_run_post"
                            }
                        }
                    }
                    required: true
                }
                responses: {
                    "200": {
                        description: "Successful Response"
                        content: {
                            "application/json": {
                                schema: BaseResponse
                            }
                        }
                    }
                    "422": ValidationErrorResponse
                }
            }
        }
    }
    components: {
        schemas: {
            AgentaNodesResponse: {}
            BaseResponse: BaseResponse
            Body_generate_generate_deployed_post: {
                properties: {
                    inputs: {
                        title: "Inputs"
                    }
                }
                type: "object"
                required: ["inputs"]
                title: "Body_generate_generate_deployed_post"
            }
            Body_generate_generate_post: {
                properties: {
                    agenta_config: AgentaConfig
                    inputs: {
                        title: "Inputs"
                    }
                }
                type: "object"
                required: ["inputs"]
                title: "Body_generate_generate_post"
            }
            Body_generate_playground_run_post: {
                properties: {
                    agenta_config: AgentaConfig
                    inputs: {
                        title: "Inputs"
                    }
                }
                type: "object"
                required: ["inputs"]
                title: "Body_generate_playground_run_post"
            }
            Body_generate_run_post: {
                properties: {
                    inputs: {
                        title: "Inputs"
                    }
                }
                type: "object"
                required: ["inputs"]
                title: "Body_generate_run_post"
            }
            Body_generate_test_post: {
                properties: {
                    agenta_config: AgentaConfig
                    inputs: {
                        title: "Inputs"
                    }
                }
                type: "object"
                required: ["inputs"]
                title: "Body_generate_test_post"
            }
            ExceptionDto: {}
            HTTPValidationError: {
                properties: {
                    detail: {
                        items: ValidationError
                        type: "array"
                        title: "Detail"
                    }
                }
                type: "object"
                title: "HTTPValidationError"
            }
            JSONSchema: {
                properties: {
                    name: {
                        type: "string"
                        title: "Name"
                    }
                    description: {
                        anyOf: [{type: "string"}, {type: "null"}]
                        title: "Description"
                    }
                    schema: {
                        anyOf: [{type: "object"}, {type: "null"}]
                        title: "Schema"
                    }
                    strict: {
                        anyOf: [{type: "boolean"}, {type: "null"}]
                        title: "Strict"
                    }
                }
                type: "object"
                required: ["name", "schema"]
                title: "JSONSchema"
            }
            Message: {
                properties: Message
                type: "object"
                required: ["role"]
                title: "Message"
            }
            LLMConfig: {
                properties: LLMConfig
                type: "object"
                title: "ModelConfig"
                description: "Configuration for model parameters"
            }
            PromptTemplate: {
                properties: {
                    messages: {
                        items: Message
                        type: "array"
                        title: "Messages"
                        default: Message[]
                    }
                    system_prompt: {
                        anyOf: [{type: "string"}, {type: "null"}]
                        title: "System Prompt"
                    }
                    user_prompt: {
                        anyOf: [{type: "string"}, {type: "null"}]
                        title: "User Prompt"
                    }
                    template_format: {
                        type: "string"
                        enum: ["fstring", "jinja2", "curly"]
                        title: "Template Format"
                        description: "Format type for template variables: fstring {var}, jinja2 {{ var }}, or curly {{var}}"
                        default: "fstring"
                    }
                    input_keys: {
                        anyOf: [
                            {
                                items: {type: "string"}
                                type: "array"
                            },
                            {type: "null"},
                        ]
                        title: "Input Keys"
                        description: "Optional list of input keys for validation. If not provided, any inputs will be accepted"
                    }
                    llm_config: LLMConfig
                }
                type: "object"
                title: "PromptTemplate"
                description: "A template for generating prompts with formatting capabilities"
            }
            ResponseFormatJSONObject: {
                properties: {
                    type: {
                        type: "string"
                        const: "json_object"
                        title: "Type"
                    }
                }
                type: "object"
                required: ["type"]
                title: "ResponseFormatJSONObject"
            }
            ResponseFormatJSONSchema: {
                properties: {
                    type: {
                        type: "string"
                        const: "json_schema"
                        title: "Type"
                    }
                    json_schema: JSONSchema
                }
                type: "object"
                required: ["type", "json_schema"]
                title: "ResponseFormatJSONSchema"
            }
            ResponseFormatText: {
                properties: {
                    type: {
                        type: "string"
                        const: "text"
                        title: "Type"
                    }
                }
                type: "object"
                required: ["type"]
                title: "ResponseFormatText"
            }
            ToolCall: {
                properties: {
                    id: {type: "string"; title: "Id"}
                    type: {
                        type: "string"
                        const: "function"
                        title: "Type"
                        default: "function"
                    }
                    function: {
                        additionalProperties: {type: "string"}
                        type: "object"
                        title: "Function"
                    }
                }
                type: "object"
                required: ["id", "function"]
                title: "ToolCall"
            }
            ValidationError: {
                properties: {
                    loc: {
                        items: {
                            anyOf: [{type: "string"}, {type: "integer"}]
                        }
                        type: "array"
                        title: "Location"
                    }
                    msg: {type: "string"; title: "Message"}
                    type: {type: "string"; title: "Error Type"}
                }
                type: "object"
                required: ["loc", "msg", "type"]
                title: "ValidationError"
            }
        }
    }
}

export interface BaseResponse {
    version?: string | null
    data?: string | object | null
    tree?: any | null
}

export interface ValidationErrorResponse {
    description: "Validation Error"
    content: {
        "application/json": {
            schema: {
                properties: {
                    detail: {
                        items: ValidationError
                        type: "array"
                        title: "Detail"
                    }
                }
                type: "object"
                title: "HTTPValidationError"
            }
        }
    }
}

export interface ValidationError {
    loc: (string | number)[]
    msg: string
    type: string
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
            template_format: "fstring" | "jinja2" | "curly"
            user_prompt: string
        }
    }
    properties: {
        prompt: AgentaPromptSchema
    }
    type: "object"
    title: "MyConfig"
}

export interface Message {
    role: "system" | "user" | "assistant" | "tool" | "function"
    content?: string | null
    name?: string | null
    tool_calls?: ToolCall[] | null
    tool_call_id?: string | null
}

export interface ToolCall {
    id: string
    type: "function"
    function: {
        [key: string]: string
    }
}

export interface LLMConfig {
    model: string
    temperature?: number | null
    max_tokens?: number | null
    top_p?: number | null
    frequency_penalty?: number | null
    presence_penalty?: number | null
    response_format?: ResponseFormat | null
    stream?: boolean | null
    tools?: any[] | null
    tool_choice?: "none" | "auto" | object | null
}

export type ResponseFormat =
    | {type: "text"}
    | {type: "json_object"}
    | {type: "json_schema"; json_schema: JSONSchema}

export interface JSONSchema {
    name: string
    description?: string | null
    schema?: object | null
    strict?: boolean | null
}

export interface Parameter {
    name: string
    type: string
    input: boolean
    required: boolean
    default?: any
    enum?: Array<string>
    minimum?: number
    maximum?: number
    choices?: {[key: string]: Array<string>}
}

export interface SchemaObject {
    type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null"
    properties?: {
        [propertyName: string]: SchemaObject
    }
    required?: string[]
    title?: string
    description?: string
    default?: any
    items?: SchemaObject
    anyOf?: SchemaObject[]
    enum?: string[]
    const?: string
    maximum?: number
    minimum?: number
    additionalProperties?: SchemaObject | boolean
}

export type PromptProperties = NonNullable<AgentaConfig["properties"]["prompt"]["properties"]>

// Type to represent schemas that contain agenta_config
export interface SchemaWithAgentaConfig {
    properties: {
        agenta_config: AgentaConfig
        inputs: {title: "Inputs"}
    }
    type: "object"
    required: string[]
    title: string
}

// if we can use
export interface PromptConfigType {
    key: string
    config: {
        messages?: MessagesSchema
        system_prompt?: Nullable<StringSchema>
        user_prompt?: Nullable<StringSchema>
        template_format?: EnumSchema<TemplateFormat>
        input_keys?: Nullable<ArraySchema<StringSchema>>
        llm_config?: LLMConfigSchema
    }
    configKey: string
    type: string
    value?: unknown
    valueKey: string
}

export interface ParsedSchema {
    schemaName: keyof OpenAPISpec["components"]["schemas"]
    promptConfig: {
        key: string
        messages: PromptConfigType
        llm_config: PromptConfigType
        template_format: PromptConfigType
        [key: string]: PromptConfigType | string
    }[]
}
