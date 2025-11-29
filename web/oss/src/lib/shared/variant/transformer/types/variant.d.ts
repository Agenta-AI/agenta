import {User} from "@/oss/lib/Types"
import {CamelCaseEnvironment} from "@/oss/lib/Types"

import {Message} from "./message"

interface LLMConfig {
    model: string
    topP?: number
    stream?: boolean
    maxTokens?: number
    temperature?: number
    presencePenalty?: number
    frequencyPenalty?: number
    reasoningEffort?: "none" | "low" | "medium" | "high" | null
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

export interface AgentaConfig extends Record<string, unknown> {
    prompt: AgentaConfigPrompt
    prompts?: AgentaConfigPrompt[]
}

/** Variant configuration structure */
export interface VariantParameters {
    ag_config?: AgentaConfig
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
    templateVariantName: string | null
    variantName: string
    parameters?: VariantParameters
    commitMessage?: string | null
    createdAtTimestamp: number
    updatedAtTimestamp: number
}

/**
 * Interface for revision object passed to adaptRevisionToVariant
 */
export interface RevisionObject {
    id?: string
    _id?: string
    revision: string | number
    parameters?: any
    config?: {
        parameters?: any
    }
    prompts?: any
    customProperties?: any
    updatedAt?: string
    createdAt?: string
    updatedAtTimestamp?: number
    createdAtTimestamp?: number
    modifiedById?: string
    modifiedBy?: string | null
    userProfile?: User | null
    commitMessage?: string | null
    isLatestRevision?: boolean
    isChatVariant?: boolean
    isLatestVariantRevision?: boolean
    deployedIn?: CamelCaseEnvironment[]
}

/**
 * Interface for parent variant object passed to adaptRevisionToVariant
 */
export interface ParentVariantObject {
    id?: string
    variantId?: string
    name?: string
    variantName?: string
    baseId?: string
    baseName?: string
    configName?: string
    appId?: string
    uri?: string
    uriObject?: any
    isChat?: boolean
    isCustom?: boolean
    isChatVariant?: boolean
    parameters?: any
    prompts?: any
    customProperties?: any
    updatedAt?: string
    createdAt?: string
    updatedAtTimestamp?: number
    createdAtTimestamp?: number
    modifiedById?: string
    modifiedBy?: string | null
    userProfile?: User | null
}
