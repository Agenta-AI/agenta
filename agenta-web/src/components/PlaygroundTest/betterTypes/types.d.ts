import type {
    SchemaType,
    BaseSchema,
    BaseMetadata,
    BaseOption,
    OptionGroup,
    SelectOptions,
    CompoundMetadata,
    BaseVariant,
} from "./baseTypes"
import type {PlaygroundPromptSchema} from "./openApiSchema"

/**
 * Core type definitions for the application
 *
 * This module contains:
 * - Base metadata interfaces for all configuration types
 * - Configuration value wrappers with type safety
 * - LLM configuration types with extensible interfaces
 * - Message and prompt type definitions
 * - Variant types for different interaction modes (chat/completion)
 */

/** Metadata interfaces */
export interface StringMetadata extends BaseMetadata {
    type: "string"
    options?: SelectOptions
    allowFreeform?: boolean
}

export interface NumberMetadata extends BaseMetadata {
    type: "number"
    min?: number
    max?: number
    isInteger?: boolean // Add isInteger flag
}

export interface BooleanMetadata extends BaseMetadata {
    type: "boolean"
    default?: boolean
}

export interface ArrayMetadata extends BaseMetadata {
    type: "array"
    itemMetadata: ConfigMetadata // Allow all metadata types for array items
    minItems?: number
    maxItems?: number
}

export interface ObjectMetadata extends BaseMetadata {
    type: "object"
    properties: Record<string, ConfigMetadata>
    additionalProperties?: boolean
}

/** Input schema for variants */
export interface InputSchema extends ArrayMetadata {
    type: "array"
    itemMetadata: ObjectMetadata & {
        properties: Record<string, StringMetadata>
    }
}

/** API Response types for test runs */
interface ExecutionMetrics {
    duration: {total: number}
    costs: {total: number}
    tokens: {
        prompt: number
        completion: number
        total: number
    }
}

interface ExecutionNode {
    lifecycle: {
        created_at: string
        updated_at: string | null
        updated_by_id: string | null
        updated_by: string | null
    }
    root: {id: string}
    tree: {id: string; type: string | null}
    node: {id: string; name: string; type: string}
    parent: {id: string} | null
    time: {start: string; end: string}
    status: {code: string; message: string | null}
    exception: unknown | null
    data: {
        inputs: Record<string, unknown>
        outputs: string | Record<string, unknown>
    }
    metrics: {
        acc: ExecutionMetrics
        unit?: ExecutionMetrics
    }
    meta: {
        configuration: Record<string, unknown>
    }
    refs: unknown | null
    links: unknown | null
    otel: {
        kind: string
        attributes: unknown | null
        events: unknown[]
        links: unknown | null
    }
    nodes: Record<string, ExecutionNode> | null
}

interface ExecutionTree {
    nodes: ExecutionNode[]
    version: string
    count: number | null
}

interface ApiResponse {
    version: string
    data: string
    content_type: string
    tree: ExecutionTree
}

/** Result structure for test runs */
export interface TestResult {
    response?: ApiResponse
    error?: string
    metadata?: Record<string, unknown>
}

/** Input row configuration with enhanced primitive values */
export interface EnhancedInputRowConfig extends EnhancedConfig<Record<string, string>> {
    __metadata: ObjectMetadata
    __result?: TestResult
    [key: string]: EnhancedConfigValue<string> | string | ObjectMetadata | TestResult | undefined // Allow spreading values at root level
}

/** Input rows array configuration */
export interface EnhancedInputConfig extends EnhancedConfig<Record<string, string>[]> {
    __metadata: InputSchema
    value: EnhancedInputRowConfig[]
}

/** Union of all metadata types */
export type ConfigMetadata =
    | StringMetadata
    | NumberMetadata
    | ArrayMetadata
    | ObjectMetadata
    | BooleanMetadata
    | CompoundMetadata

// Simplify PropertyMetadata definition
export type PropertyMetadata = ConfigMetadata

// Use PropertyMetadata in EnhancedConfig
export type EnhancedConfig<T> = {
    __id: string
    __metadata: PropertyMetadata
}

/** Enhanced primitive value with metadata */
export type EnhancedConfigValue<T> = EnhancedConfig<T> & {
    value: T
}

/** Enhanced array item base */
export interface EnhancedArrayItemBase {
    __id: string
    __metadata: ConfigMetadata
}

/** Enhanced primitive array item */
export interface EnhancedPrimitiveArrayItem<T> extends EnhancedArrayItemBase {
    value: T
}

/** Enhanced object array item */
export type EnhancedObjectArrayItem<T> = EnhancedArrayItemBase & {
    [K in keyof T]: EnhancedConfigValue<T[K]>
}

/** Enhanced array item structure */
export type EnhancedArrayItem<T> = EnhancedPrimitiveArrayItem<T> | EnhancedObjectArrayItem<T>

/** Enhanced array structure */
export type EnhancedArrayValue<T> = EnhancedConfig<T[]> & {
    value: EnhancedArrayItem<T>[]
}

/** Generic enhanced configuration type */
export type Enhanced<T> =
    T extends Array<infer U>
        ? EnhancedArrayValue<U>
        : T extends Record<string, any>
          ? EnhancedObjectConfig<T>
          : EnhancedConfigValue<T>

/** Message interface matching the schema */
export interface ChatMessage {
    role: string
    content: string
    name?: string
    toolCalls?: Array<{
        id: string
        type: string
        function: Record<string, unknown>
    }>
    toolCallId?: string
}

/** Enhanced message where each field is enhanced individually */
export type EnhancedChatMessage = {
    __id: string
    __metadata: ObjectMetadata
} & {
    [K in keyof ChatMessage]: EnhancedConfigValue<ChatMessage[K]>
}

/** Enhanced message in array item format */
export interface EnhancedArrayMessage extends EnhancedArrayItemBase {
    role: EnhancedConfigValue<string>
    content: EnhancedConfigValue<string>
    name?: EnhancedConfigValue<string>
    toolCalls?: EnhancedArrayValue<{
        id: string
        type: string
        function: Record<string, unknown>
    }>
    toolCallId?: EnhancedConfigValue<string>
}

/** Enhanced array structure specifically for messages */
export interface EnhancedMessageArray extends EnhancedConfig<ChatMessage[]> {
    value: EnhancedArrayMessage[]
}

/** Prompt interface structure */
export interface PromptConfig
    extends EnhancedConfig<{
        messages: ChatMessage[]
        llmConfig: {
            model: string
            temperature?: number
            maxTokens?: number
            topP?: number
            frequencyPenalty?: number
            presencePenalty?: number
            stream?: boolean
            responseFormat?: {
                type: string
            }
            tools?: any[]
            toolChoice?: "none" | "auto" | null
        }
        templateFormat?: "fstring" | "jinja2" | "curly"
        systemPrompt?: string
        userPrompt?: string
        inputKeys: string[]
    }> {
    value: {
        messages: ChatMessage[]
        llmConfig: {
            model: string
            temperature?: number
            maxTokens?: number
            topP?: number
            frequencyPenalty?: number
            presencePenalty?: number
            stream?: boolean
            responseFormat?: {
                type: string
            }
            tools?: any[]
            toolChoice?: "none" | "auto" | null
        }
        templateFormat?: "fstring" | "jinja2" | "curly"
        systemPrompt?: string
        userPrompt?: string
        inputKeys: string[]
    }
    messages: EnhancedMessageArray
    llmConfig: Enhanced<{
        model: string
        temperature?: number
        maxTokens?: number
        topP?: number
        frequencyPenalty?: number
        presencePenalty?: number
        stream?: boolean
        responseFormat?: {
            type: string
        }
        tools?: any[]
        toolChoice?: "none" | "auto" | null
    }>
    templateFormat?: EnhancedConfigValue<"fstring" | "jinja2" | "curly">
    systemPrompt?: EnhancedConfigValue<string>
    userPrompt?: EnhancedConfigValue<string>
    inputKeys: EnhancedConfigValue<string[]>
}

/** Enhanced Variant with embedded metadata */
interface EnhancedVariant extends BaseVariant {
    isChat: boolean
    prompts: Array<PromptConfig>
    inputs: EnhancedInputConfig
    messages: EnhancedMessageArray
}

// Export only the types that are actually used
export type {SchemaType, ConfigMetadata, BaseVariant, EnhancedVariant, PropertyMetadata}
