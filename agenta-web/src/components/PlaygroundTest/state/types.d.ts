import {Variant} from "@/lib/Types"
import {SWRConfiguration, Key, Middleware} from "swr"
import type {SchemaObject, ParsedSchema} from "../types/openapi"

// Base state types
export interface StateVariant extends Omit<Variant, "parameters"> {
    schema?: ParsedSchema
    appId: string
    baseId: string
    baseName: string
    revision: string | number
    configName: string
    projectId: string
    appName: string
}

export type ModelDefaults = {
    config: ConfigProperty
    configKey: string
    key: string
    value: ConfigProperty["default"]
}

export type PromptDefaults = {
    config: ConfigProperty
    configKey: string
    key: string
    value: Pick<ConfigProperty, "default">
}

type GroupConfigReturn<R extends boolean, P extends boolean> = R extends true
    ? P extends true
        ? PromptDefaults[]
        : ModelDefaults[]
    : ConfigProperty[]

export type InitialStateType = {
    variants: StateVariant[]
    selected?: StateVariant
}

// Configuration types

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

interface BaseSchemaProperty {
    type?: string
    title?: string
    description?: string
    default?: any
    enum?: string[]
    maximum?: number
    minimum?: number
    anyOf?: Array<{type?: string} | {type?: "null"}>
}

interface ObjectSchemaProperty extends BaseSchemaProperty {
    properties?: Record<string, BaseSchemaProperty>
    additionalProperties?: boolean
}

interface ArraySchemaProperty extends BaseSchemaProperty {
    items?: BaseSchemaProperty & {
        properties?: Record<string, BaseSchemaProperty>
    }
}

// Configuration Property Types
interface BaseConfigProperty {
    title: string
    value: any
}

interface StringConfigProperty extends BaseConfigProperty {
    type: "string"
    value: string | string[]
    choices?: Array<{label: string; value: string}>
}

interface NumberConfigProperty extends BaseConfigProperty {
    type: "number" | "integer"
    value: number | null
    minimum?: number
    maximum?: number
}

interface BooleanConfigProperty extends BaseConfigProperty {
    type: "boolean"
    value: boolean
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
