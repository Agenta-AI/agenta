import {StaticImageData} from "next/image"
import {EvaluationFlow, EvaluationType} from "./enums"
import {GlobalToken} from "antd"

export type JSSTheme = GlobalToken & {isDark: boolean}

export interface testset {
    _id: string
    name: string
    created_at: string
}

export interface TestSet {
    id: string
    name: string
    created_at: string
    updated_at: string
    csvdata: KeyValuePair[]
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
    configName: string
}

// Define the interface for the tabs item in playground page
export interface PlaygroundTabsItem {
    key: string
    label: string
    children: JSX.Element
    closable: boolean
}

export interface LLMRunRateLimit {
    batch_size: number
    max_retries: number
    retry_delay: number
    delay_between_batches: number
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
        testsetChatColumn: string
    } & TestSet
    appName: string
    llmAppPromptTemplate?: string
    evaluationTypeSettings: {
        similarityThreshold: number
        regexPattern: string
        regexShouldMatch: boolean
        webhookUrl: string
        customCodeEvaluationId?: string
        llmAppPromptTemplate?: string
        evaluationPromptTemplate?: string
    }
    revisions: string[]
    variant_revision_ids: string[]
}

export interface EvaluationScenario {
    id: string
    evaluation_id: string
    inputs: {input_name: string; input_value: string}[]
    outputs: {variant_id: string; variant_output: string}[]
    correctAnswer: string | null
    vote?: string | null
    score?: string | number | null
    isPinned: boolean
    note: string
}

//TODO: modify this to accomodate results of other evaluation types
// currently only used for human_a_b_testing
export interface EvaluationResult {
    votes_data: {
        nb_of_rows: number
        flag_votes: {
            number_of_votes: number
            percentage: number
        }
        positive_votes: {
            number_of_votes: number
            percentage: number
        }
        variants: string[]
        variant_names: string[]
        variants_votes_data: {
            [id: string]: {
                number_of_votes: number
                percentage: number
            }
        }
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

export interface Parameters {
    frequence_penalty: number
    inputs: [{}]
    max_tokens: number
    model: string
    presence_penalty: number
    prompt_system: string
    prompt_user: string
    temperature: number
    top_p: number
}

export interface DeploymentRevisionConfig {
    config_name: string
    current_version: number
    parameters: Parameters
}

export interface IPromptRevisions {
    config: {
        config_name: string
        parameters: Parameters
    }
    created_at: string
    modified_by: string
    revision: number
}

export interface IEnvironmentRevision {
    revision: number
    modified_by: string
    created_at: string
}

export interface IPromptVersioning {
    app_id: string
    app_name: string
    base_id: string
    base_name: string
    config_name: string
    organization_id: string
    parameters: Parameters
    previous_variant_name: string | null
    revision: number
    revisions: [IPromptRevisions]
    uri: string
    user_id: string
    variant_id: string
    variant_name: string
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
    variants_revision_ids: string[]
    revisions: string[] // The revision number
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

export interface LlmProvidersKeys {
    OPENAI_API_KEY: string
    REPLICATE_API_KEY: string
    HUGGING_FACE_API_KEY: string
    COHERE_API_KEY: string
    ANTHROPIC_API_KEY: string
    AZURE_API_KEY: string
    AZURE_API_BASE: string
    TOGETHERAI_API_KEY: string
}

export interface AppTemplate {
    app_name: string
    template_id: string
    env_vars?: Record<string, string>
    organization_id?: string
    workspace_id?: string
}

export type GenericObject = Record<string, any>
export type KeyValuePair = Record<string, string>

export interface Environment {
    name: string
    app_id: string
    deployed_app_variant_id: string | null
    deployed_variant_name: string | null
    deployed_app_variant_revision_id: string | null
    revision: string | null
}

export interface DeploymentRevisions extends Environment {
    revisions: {
        created_at: string
        deployed_app_variant_revision: string
        deployment: string
        id: string
        modified_by: string
        revision: number
    }[]
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

export enum ChatRole {
    System = "system",
    User = "user",
    Assistant = "assistant",
    Function = "function",
}

export type ChatMessage = {
    role: ChatRole
    content: string
    id?: string
}

type ValueType = number | string | boolean | GenericObject | null
type ValueTypeOptions =
    | "text"
    | "number"
    | "boolean"
    | "bool"
    | "string"
    | "code"
    | "regex"
    | "object"
    | "error"

//evaluation revamp types
export interface EvaluationSettingsTemplate {
    type: ValueTypeOptions
    label: string
    default?: ValueType
    description: string
}

export interface Evaluator {
    name: string
    key: string
    settings_template: Record<string, EvaluationSettingsTemplate>
    icon_url?: string | StaticImageData
    color?: string
    direct_use?: boolean
}

export interface EvaluatorConfig {
    id: string
    evaluator_key: string
    name: string
    settings_values: Record<string, any>
    created_at: string
}

export type EvaluationError = {
    message: string
    stacktrace: string
}

export interface TypedValue {
    type: ValueTypeOptions
    value: ValueType
    error: null | EvaluationError
}

export enum EvaluationStatus {
    INITIALIZED = "EVALUATION_INITIALIZED",
    STARTED = "EVALUATION_STARTED",
    FINISHED = "EVALUATION_FINISHED",
    FINISHED_WITH_ERRORS = "EVALUATION_FINISHED_WITH_ERRORS",
    ERROR = "EVALUATION_FAILED",
}

export enum EvaluationStatusType {
    STATUS = "status",
    ERROR = "error",
}

export interface _Evaluation {
    id: string
    appId: string
    user: {
        id: string
        username: string
    }
    testset: {
        id: string
        name: string
    }
    status: {
        type: EvaluationStatusType
        value: EvaluationStatus
        error: null | EvaluationError
    }
    variants: {variantId: string; variantName: string}[]
    aggregated_results: {
        evaluator_config: EvaluatorConfig
        result: TypedValue & {error: null | EvaluationError}
    }[]
    created_at?: string
    updated_at?: string
    duration?: number
    revisions: string[]
    variant_revision_ids: string[]
}

export interface _EvaluationScenario {
    id: string
    evaluation_id: string
    evaluation: _Evaluation
    evaluators_configs: EvaluatorConfig[]
    inputs: (TypedValue & {name: string})[]
    outputs: {result: TypedValue}[]
    correct_answer?: string
    is_pinned?: boolean
    note?: string
    results: {evaluator_config: string; result: TypedValue & {error: null | EvaluationError}}[]
}

export interface Annotation {
    id: string
    app_id: string
    variants: {variantId: string; variantName: string}[]
    annotation_name: "flag" | "score"
    testset: {
        id: string
        name: string
    }
    aggregated_results: string[]
}

export interface AnnotationScenario {
    id: string
    annotation_id: string
    annotation: Annotation
    inputs: (TypedValue & {name: string})[]
    outputs: TypedValue[]
    is_pinned?: boolean
    note?: string
    result: TypedValue
}

export type ComparisonResultRow = {
    inputs: {name: string; value: string}[]
    correctAnswer: string
    variants: {
        variantId: string
        variantName: string
        output: {result: TypedValue}
        evaluationId: string
        evaluatorConfigs: {
            evaluatorConfig: EvaluatorConfig
            result: TypedValue & {error: null | EvaluationError}
        }[]
    }[]
    id: string
}

export type RequestMetadata = {
    cost: number
    latency: number
    usage: {completion_tokens?: number; prompt_tokens?: number; total_tokens: number}
}

export type WithPagination<T> = {
    data: T[]
    total: number
    page: number
    pageSize: number
}

export type PaginationQuery = {
    page: number
    pageSize: number
}
