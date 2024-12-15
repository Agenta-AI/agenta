import {Variant} from "@/lib/Types"
import {SWRConfiguration, Key, Middleware} from "swr"

// Base state types
export interface StateVariant extends Variant {
    schema?: OpenAPISchema
    appId: string
    baseId: string
    baseName: string
    revision: string | number
    configName: string
    projectId: string
    appName: string
}

export type InitialStateType = {
    variants: StateVariant[]
    selected?: StateVariant
}

// Configuration types
export interface UsePlaygroundStateOptions extends SWRConfiguration {
    service?: string
    appId?: string
    projectId?: string
    hookId?: string
    selector?: (state: InitialStateType) => any
    compare?: (a: InitialStateType | undefined, b: InitialStateType | undefined) => boolean
}

export type SWRCache = Map<string, any>

export interface SWRConfigWithCache extends SWRConfiguration {
    cache: SWRCache
}

export type StateMiddleware = Middleware<
    InitialStateType, // Return type of the fetcher
    Error, // Error type
    SWRConfigWithCache, // Config type with proper cache
    Key // Key type from SWR
>

// OpenAPI related types
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
            [name: string]: SchemaObject
        }
    }
}

export interface SchemaObject {
    type?: string
    properties?: {
        [name: string]: SchemaObject
    }
    items?: SchemaObject
    anyOf?: SchemaObject[]
    required?: string[]
    title?: string
    default?: any
    maximum?: number
    minimum?: number
    ["x-parameter"]?: string
    choices?: {
        [category: string]: string[]
    }
}

// Configuration Property Types
interface BaseConfigProperty {
    title: string
    default: any
}

interface StringConfigProperty extends BaseConfigProperty {
    type: "string"
    default: string | string[]
    choices?: Array<{label: string; value: string}>
}

interface NumberConfigProperty extends BaseConfigProperty {
    type: "number" | "integer"
    default: number
    minimum?: number
    maximum?: number
}

interface BooleanConfigProperty extends BaseConfigProperty {
    type: "boolean"
    default: boolean
}

export type ConfigPropertyType = StringConfigProperty | NumberConfigProperty | BooleanConfigProperty

// Playground Types
export interface Variant {
    id: string
    name: string
    config: Record<string, any>
    defaultConfig: Record<string, ConfigPropertyType>
}

export interface PlaygroundState {
    variants: Record<string, Variant>
    activeVariant: string | null
    evaluations: Record<string, any>
}

export type PlaygroundAction =
    | {type: "SET_ACTIVE_VARIANT"; payload: string}
    | {type: "UPDATE_VARIANT"; payload: {id: string; config: any}}
    | {type: "ADD_VARIANT"; payload: Variant}
    | {type: "REMOVE_VARIANT"; payload: string}

// New generic type definitions
export type ModelProvider =
    | "Mistral AI"
    | "Open AI"
    | "Gemini"
    | "Cohere"
    | "Anthropic"
    | "Anyscale"
    | "Perplexity AI"
    | "DeepInfra"
    | "Together AI"
    | "Aleph Alpha"
    | "OpenRouter"
    | "Groq"

export type ModelChoices = {
    [key in ModelProvider]: string[]
}

export type ConfigProperty = {
    type: string
    title: string
    default: any
    key: string
    configKey: string
    maximum?: number
    minimum?: number
    choices?: ModelChoices
    "x-parameter"?: string
}
