import {Message} from "./message"

interface LLMConfig {
    model: string
    topP?: number
    stream?: boolean
    maxTokens?: number
    temperature?: number
    presencePenalty?: number
    frequencyPenalty?: number
    responseFormat?: string
    tools?: any[]
    toolChoice?: "none" | "auto" | null
}

export interface AgentaConfigPrompt {
    messages: Message[]
    llmConfig: LLMConfig
    inputKeys: string[]
    templateFormat?: string
}

export interface AgentaConfig {
    prompt: AgentaConfigPrompt
    prompts?: AgentaConfigPrompt[]
}

/** Variant configuration structure */
export interface VariantParameters {
    agConfig: AgentaConfig
}

/** Base variant interface */
export interface BaseVariant {
    id: string
    uri: string
    name: string
    version?: string
    createdAt?: string
    updatedAt?: string
    appId: string
    baseId: string
    baseName: string
    revision: string | number
    configName: string
    projectId: string
    appName: string
    templateVariantName: string
    variantName: string
    parameters?: VariantParameters
}
