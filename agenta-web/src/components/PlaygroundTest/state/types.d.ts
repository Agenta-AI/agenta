import {Variant} from "@/lib/Types"
import {SWRConfiguration, Key, Middleware} from "swr"
import type {BaseSchema, StringSchema, NumberSchema, BooleanSchema, WithConfig} from "./shared"
import {ParsedSchema} from "../types/parsedSchema"

// Model Provider Types
// export type ModelProvider =
//     | "Mistral AI"
//     | "Open AI"
//     | "Gemini"
//     | "Cohere"
//     | "Anthropic"
//     | "Anyscale"
//     | "Perplexity AI"
//     | "DeepInfra"
//     | "Together AI"
//     | "Aleph Alpha"
//     | "OpenRouter"
//     | "Groq"

// export type ModelChoices = {
//     [key in ModelProvider]: string[]
// }

export interface StateVariant extends Omit<Variant, "schema"> {
    schema?: ParsedSchema
    appId: string
    baseId: string
    baseName: string
    revision: string | number
    configName: string
    projectId: string
    appName: string
}

// State Types
export interface InitialStateType {
    variants: StateVariant[]
    selected?: StateVariant
    addVariant?: (baseVariantName: string, newVariantName: string) => void
    deleteVariant?: () => void
    saveVariant?: () => void
    dirtyStates?: Map<string, boolean>
}

export type PlaygroundAction =
    | {type: "SET_ACTIVE_VARIANT"; payload: string}
    | {type: "UPDATE_VARIANT"; payload: {id: string; config: any}}
    | {type: "ADD_VARIANT"; payload: Variant}
    | {type: "REMOVE_VARIANT"; payload: string}
