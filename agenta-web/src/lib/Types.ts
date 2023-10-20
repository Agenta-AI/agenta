import {EvaluationFlow, EvaluationType} from "./enums"

export interface testset {
    _id: string
    name: string
    created_at: string
}

export interface ListAppsItem {
    app_id: string
    app_name: string
}

export interface AppVariant {
    id: number
    name: string
    endpoint: string
}

export interface Variant {
    variantName: string
    templateVariantName: string | null // template name of the variant in case it has a precursor. Needed to compute the URI path
    persistent: boolean // whether the variant is persistent in the backend or not
    parameters: Record<string, string> | null // parameters of the variant. Only set in the case of forked variants
    previousVariantName?: null | string // name of the variant that was forked from. Only set in the case of forked variants
    variantId: string
    baseId: string
    baseName: string
    configId: string
    configName: string
}

// Define the interface for the tabs item in playground page
export interface PlaygroundTabsItem {
    key: string
    label: string
    children: JSX.Element
    closable: boolean
}

export interface Evaluation {
    id: string
    createdAt: string
    createdBy: string
    user: {
        id: string
        username: string
    }
    variants: Variant[]
    evaluationType: EvaluationType
    status: EvaluationFlow
    testset: {
        _id: string
        name: string
    }
    appName: string
    llmAppPromptTemplate?: string
    evaluationTypeSettings: {
        similarityThreshold: number
        regexPattern: string
        regexShouldMatch: boolean
        webhookUrl: string
        customCodeEvaluationId?: string
        llmAppPromptTemplate?: string
    }
}

export interface CreateCustomEvaluation {
    evaluation_name: string
    python_code: string
    app_id: string
}

export interface CreateCustomEvaluationSuccessResponse {
    status: string
    message: string
    evaluation_id: string
}

export interface ExecuteCustomEvalCode {
    evaluation_id: string
    inputs: Array<Object>
    outputs: Array<Object>
    variant_id: string
    correct_answer: string
    app_id: string
}

export interface SingleCustomEvaluation {
    id: string
    app_name: string
    evaluation_name: string
}

export interface AICritiqueCreate {
    correct_answer: string
    llm_app_prompt_template?: string
    inputs: Array<Object>
    outputs: Array<Object>
    evaluation_prompt_template: string
    open_ai_key: string
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
}

export interface EvaluationResponseType {
    id: string
    variant_ids: string[]
    variant_names: string[]
    votes_data: {
        variants_votes_data: {
            number_of_votes: number
            percentage: number
        }
        flag_votes: {number_of_votes: number; percentage: number}
    }
    app_id: string
    status: string
    evaluation_type: string
    evaluation_type_settings: {
        similarity_threshold: number
        regex_pattern: string
        regex_should_match: boolean
        webhook_url: string
        custom_code_evaluation_id?: string
        llm_app_prompt_template?: string
    }
    testset_name: string
    testset_id: string
    created_at: string
    user_username: string
    user_id: string
}

export type LanguageItem = {displayName: string; languageKey: string}

export interface ResultsTableDataType {
    id: string
    variants: string[]
    votesData?: {
        variants_votes_data: {
            number_of_votes: number
            percentage: number
        }
        flag_votes: {number_of_votes: number; percentage: number}
    }
    scoresData?: any
    evaluationType: EvaluationType
    createdAt?: string
    avgScore?: number
}

/**
 * Used to define the additional inputs the user can add to a variant through DictInput in the SDK
 */
export interface InputParameter {
    name: string
}

export interface Template {
    id: string
    image: {
        id: string
        name: string
        digest: string
        title: string
        description: string
    }
}

export interface TemplateImage {
    image_tag: string
    image_id: string
    message?: string
}

export interface AppTemplate {
    app_name: string
    template_id: string
    env_vars?: {
        OPENAI_API_KEY: string | null
    }
    organization_id?: string
}

export type GenericObject = Record<string, any>
export type KeyValuePair = Record<string, string>

export interface Environment {
    name: string
    app_id: string
    deployed_app_variant_id: string | null
    deployed_variant_name: string | null
}

export interface CustomEvaluation {
    id: string
    app_name: string
    evaluation_name: string
    python_code: string
    created_at: string
    updated_at: string
}

export interface User {
    id: string
    uid: string
    username: string
    email: string
}

export interface Org {
    id: string
    name: string
    description?: string
    owner: string
}
