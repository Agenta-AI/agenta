// Type utilities for parsing path strings
type PathImpl<T, K extends keyof T> = K extends string
    ? T[K] extends Record<string, any>
        ? T[K] extends ArrayLike<any>
            ?
                  | K
                  | `${K}.[${number}]`
                  | `${K}.[${number}].${PathImpl<T[K][number], keyof T[K][number] & string>}`
            : K | `${K}.${PathImpl<T[K], keyof T[K] & string>}`
        : K
    : never

// Export the Path type
export type Path<T> = PathImpl<T, keyof T & string> | keyof T

// Get the type for a specific path
export type PathValue<T, P extends string> = P extends keyof T
    ? T[P]
    : P extends `${infer K}.${infer R}`
      ? K extends keyof T
          ? R extends `[${infer N}]${infer Rest}`
              ? N extends `${number}`
                  ? T[K] extends ArrayLike<infer V>
                      ? Rest extends `.${infer Rest2}`
                          ? PathValue<V, Rest2>
                          : V
                      : never
                  : never
              : PathValue<T[K], R>
          : never
      : never

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

// interface PromptConfigType {
//     key: string
//     config: Record<string, any>
//     configKey: string
//     valueKey: string
//     type?: string
//     value: ModelConfig | ArrayType | AnyOfType | StringType | undefined
// }

// interface ParsedSchema {
//     schemaName: string
//     promptConfig: {
//         key: string
//         messages: PromptConfigType
//         llm_config: PromptConfigType
//         template_format: PromptConfigType
//         [key: string]: PromptConfigType | string
//     }[]
// }

// export interface SchemaObject {
//     type?: string
//     properties?: {
//         messages?: {
//             items?: {
//                 properties?: Message
//                 type?: string
//                 required?: string[]
//                 title?: string
//             }
//             type?: string
//             title?: string
//             default?: Array<{role?: string; content?: string}>
//         }
//         system_prompt?: AnyOfType
//         user_prompt?: AnyOfType
//         template_format?: StringType
//         input_keys?: AnyOfType
//         llm_config?: ModelConfig
//         agenta_config?: AgentaConfig
//     }
//     // items?: SchemaObject
//     // anyOf?: SchemaObject[]
//     // required?: string[]
//     // title?: string
//     // default?: any
//     // maximum?: number
//     // minimum?: number
//     // enum?: string[]
//     // description?: string
//     // additionalProperties?: boolean
// }
