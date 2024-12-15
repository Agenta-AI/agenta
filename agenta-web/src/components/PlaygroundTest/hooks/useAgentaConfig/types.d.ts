import type {ModelProvider, ModelChoices, ConfigProperty} from "../../state/types"

export type ModelDefaults = {
    temperature: number
    model: string
    max_tokens: number
    top_p: number
    frequence_penalty: number
    presence_penalty: number
    force_json: boolean
    key: string
}

export type PromptDefaults = {
    prompt_system: string
    prompt_user: string
    key: string
}

export type PromptConfigType = {
    key: string
    modelProperties: ConfigProperty[]
    modelDefaults: ModelDefaults
    promptProperties: ConfigProperty[]
    promptDefaults: PromptDefaults
}
