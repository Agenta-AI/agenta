interface AnyOfType {
    type?: string
}

interface StringType {
    type: "string"
    enum?: string[]
    title?: string
    default?: string
}

interface NumberType {
    type: "number"
    maximum?: number
    minimum?: number
    title?: string
    default?: number
}

interface IntegerType {
    type: "integer"
    minimum?: number
    title?: string
    description?: string
    default?: number
}

interface BooleanType {
    type: "boolean"
    title?: string
    default?: boolean
}

interface ObjectType {
    type: "object"
    title?: string
    description?: string
    properties?: Record<string, AnyOfType>
    additionalProperties?: boolean
}

export interface ArrayType {
    type: "array"
    items?: AnyOfType & {
        properties?: Record<string, AnyOfType>
    }
    title?: string
    default?: any[]
}

interface Message {
    role: StringType
    content: AnyOfType
    name: AnyOfType
    tool_calls: AnyOfType
    tool_call_id: AnyOfType
}

interface ToolCall {
    id: StringType
    type: StringType
    function: ObjectType
}

interface ModelConfig {
    type: "object"
    model?: StringType
    temperature?: NumberType
    max_tokens?: IntegerType
    top_p?: NumberType
    frequency_penalty?: NumberType
    presence_penalty?: NumberType
    response_format?: AnyOfType
    stream?: BooleanType
    tools: AnyOfType
    tool_choice: AnyOfType
    valueKey?: string
}

interface PromptTemplate {
    messages: ArrayType
    system_prompt: AnyOfType
    user_prompt: AnyOfType
    template_format: StringType
    input_keys: AnyOfType
    llm_config: ModelConfig
}

interface MyConfig {
    prompt: PromptTemplate
}

interface BaseResponse {
    version: AnyOfType
    data: AnyOfType
    tree: AnyOfType
}

interface HTTPValidationError {
    detail: ArrayType
}

interface ValidationError {
    loc: ArrayType
    msg: StringType
    type: StringType
}

interface AgentaConfig {
    properties?: {
        prompt?: {
            properties?: {
                messages?: ArrayType
                system_prompt?: AnyOfType
                user_prompt?: AnyOfType
                template_format?: StringType
                input_keys?: AnyOfType
                llm_config?: ModelConfig
            }
        }
        [key: string]: any
    }
    default?: {
        prompt?: PromptTemplate | PromptTemplate[]
    }
}

interface PromptConfigType {
    key: string
    config: Record<string, any>
    configKey: string
    valueKey: string
    type?: string
    value: ModelConfig | ArrayType | AnyOfType | StringType | undefined
}

interface ParsedSchema {
    schemaName: string
    promptConfig: {
        key: string
        messages: PromptConfigType
        llm_config: PromptConfigType
        template_format: PromptConfigType
        [key: string]: PromptConfigType | string
    }[]
}

export interface SchemaObject {
    type?: string
    properties?: {
        messages?: {
            items?: {
                properties?: Message
                type?: string
                required?: string[]
                title?: string
            }
            type?: string
            title?: string
            default?: Array<{role?: string; content?: string}>
        }
        system_prompt?: AnyOfType
        user_prompt?: AnyOfType
        template_format?: StringType
        input_keys?: AnyOfType
        llm_config?: ModelConfig
        agenta_config?: AgentaConfig
    }
    // items?: SchemaObject
    // anyOf?: SchemaObject[]
    // required?: string[]
    // title?: string
    // default?: any
    // maximum?: number
    // minimum?: number
    // enum?: string[]
    // description?: string
    // additionalProperties?: boolean
}

export interface OpenAPISchema {
    openapi: string
    info: {
        title: string
        version: string
    }
    paths: {
        [path: string]: {
            [method: string]: {
                summary?: string
                operationId?: string
                requestBody?: {
                    content: {
                        "application/json": {
                            schema: SchemaObject
                        }
                    }
                    required?: boolean
                }
                responses: {
                    [code: string]: {
                        description: string
                        content?: {
                            "application/json": {
                                schema: SchemaObject
                            }
                        }
                    }
                }
            }
        }
    }
    components: {
        schemas: {
            AgentaNodesResponse: SchemaObject
            BaseResponse: BaseResponse
            Body_generate_generate_deployed_post: SchemaObject
            Body_generate_generate_post: SchemaObject
            Body_generate_playground_run_post: SchemaObject
            Body_generate_run_post: SchemaObject
            Body_generate_test_post: SchemaObject
            ExceptionDto: SchemaObject
            HTTPValidationError: HTTPValidationError
            LifecycleDto: SchemaObject
            LinkDto: SchemaObject
            Message: Message
            ModelConfig: ModelConfig
            MyConfig: MyConfig
            NodeDto: SchemaObject
            OTelContextDto: SchemaObject
            OTelEventDto: SchemaObject
            OTelExtraDto: SchemaObject
            OTelLinkDto: SchemaObject
            ParentDto: SchemaObject
            PromptTemplate: PromptTemplate
            ResponseFormat: ObjectType
            RootDto: SchemaObject
            SpanDto: SchemaObject
            StatusDto: SchemaObject
            TimeDto: SchemaObject
            ToolCall: ToolCall
            TreeDto: SchemaObject
            ValidationError: ValidationError
        }
    }
}
