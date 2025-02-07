import {StaticImageData} from "next/image"
import {EvaluationFlow, EvaluationType} from "./enums"
import {GlobalToken} from "antd"
import {AgentaNodeDTO} from "@/services/observability/types"

export type JSSTheme = GlobalToken & {isDark: boolean; fontWeightMedium: number}

export interface testset {
    _id: string
    name: string
    created_at: string
    updated_at: string
}

export interface TestSet {
    id: string
    name: string
    created_at: string
    updated_at: string
    csvdata: KeyValuePair[]
}

export type TestsetCreationMode = "create" | "clone" | "rename"

export interface ListAppsItem {
    app_id: string
    app_name: string
    app_type?: string
    updated_at: string
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
    uri?: string
    baseId: string
    baseName: string
    configName: string
    revision: number
    updatedAt: string
    createdAt: string
    modifiedById: string
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
    choices?: {[key: string]: Array<string>}
}

export interface IPromptRevisions {
    config: {
        config_name: string
        parameters: Record<string, any>
    }
    created_at: string
    modified_by: string
    revision: number
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
    MISTRAL_API_KEY: string
    GROQ_API_KEY: string
    GEMINI_API_KEY: string
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
    | "cost"
    | "latency"
    | "hidden"
    | "messages"
    | "multiple_choice"

//evaluation revamp types
export interface EvaluationSettingsTemplate {
    type: ValueTypeOptions
    label: string
    default?: ValueType
    description: string
    min?: number
    max?: number
    required?: boolean
    advanced?: boolean
    options?: string[]
}

export interface Evaluator {
    name: string
    key: string
    settings_template: Record<string, EvaluationSettingsTemplate>
    icon_url?: string | StaticImageData
    color?: string
    direct_use?: boolean
    description: string
    oss?: boolean
    requires_llm_api_keys?: boolean
    tags: string[]
}

export interface EvaluatorConfig {
    id: string
    evaluator_key: string
    name: string
    settings_values: Record<string, any>
    created_at: string
    color?: string
    updated_at: string
    tags?: string[]
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
    AGGREGATION_FAILED = "EVALUATION_AGGREGATION_FAILED",
}

export enum EvaluationStatusType {
    STATUS = "status",
    ERROR = "error",
}

export interface CorrectAnswer {
    key: string
    value: string
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
    average_latency?: TypedValue & {error: null | EvaluationError}
    average_cost?: TypedValue & {error: null | EvaluationError}
    total_cost?: TypedValue & {error: null | EvaluationError}
    variant_revision_ids: string[]
}

export interface _EvaluationScenario {
    id: string
    evaluation_id: string
    evaluation: _Evaluation
    evaluators_configs: EvaluatorConfig[]
    inputs: (TypedValue & {name: string})[]
    outputs: {result: TypedValue; cost?: number; latency?: number}[]
    correct_answers?: CorrectAnswer[]
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
    variants: {
        variantId: string
        variantName: string
        output: {result: TypedValue; cost?: number; latency?: number}
        evaluationId: string
        evaluatorConfigs: {
            evaluatorConfig: EvaluatorConfig
            result: TypedValue & {error: null | EvaluationError}
        }[]
    }[]
    id: string
} & {[key: string]: any}

export type RequestMetadata = {
    cost: number
    latency: number
    usage:
        | {completion?: number; prompt?: number; total: number}
        | {completion_tokens?: number; prompt_tokens?: number; total_tokens: number}
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

export type StyleProps = {
    themeMode: "dark" | "light"
}

export interface SingleModelEvaluationListTableDataType {
    key: string
    variants: Variant[]
    testset: {
        _id: string
        name: string
    }
    evaluationType: string
    status: EvaluationFlow
    scoresData: {
        nb_of_rows: number
        wrong?: GenericObject[]
        correct?: GenericObject[]
        true?: GenericObject[]
        false?: GenericObject[]
        variant: string[]
    }
    avgScore: number
    custom_code_eval_id: string
    resultsData: {[key: string]: number}
    createdAt: string
    revisions: string[]
    variant_revision_ids: string[]
}

export type FuncResponse = {
    message: string
    cost: number
    latency: number
    usage: {completion_tokens: number; prompt_tokens: number; total_tokens: number}
}

export interface TraceDetailsV2 {
    trace_id: string
    cost?: number
    latency?: number
    usage: {completion_tokens: number; prompt_tokens: number; total_tokens: number}
    spans?: BaseResponseSpans[]
}

export interface TraceDetailsV3 {
    version: string
    nodes: AgentaNodeDTO[]
    count?: number | null
}

export type BaseResponse = {
    version?: string | null
    data: string | Record<string, any>
} & Partial<{tree: TraceDetailsV3} & {trace: TraceDetailsV2}>

export type BaseResponseSpans = {
    id: string
    app_id?: string
    variant_id?: string
    variant_name?: string
    inputs?: Record<string, any>
    outputs?: Record<string, any> | string[]
    internals?: Record<string, any> | null
    config?: Record<string, any> | null
    environment?: string
    tags?: string[] | null
    token_consumption?: number | null
    name: string
    parent_span_id?: string | null
    attributes?: Record<string, any>
    spankind: string
    status: TraceSpanStatus
    user?: string | null
    start_time: string
    end_time: string
    tokens?: {
        completion_tokens: number
        prompt_tokens: number
        total_tokens: number
    } | null
    cost?: number | null
}

export interface TraceSpan {
    id: string
    created_at: string
    variant: {
        variant_id: string | null
        variant_name: string | null
        revision: number | null
    }
    environment: string | null
    status: TraceSpanStatus
    error?: string
    spankind: string
    metadata?: TraceSpanMetadata
    user_id?: string | null
    children?: TraceSpan[] | null
    parent_span_id?: string | null
    name?: string
    content: {
        inputs: Record<string, any> | null
        internals: Record<string, any> | null
        outputs: string[] | Record<string, any> | null
        role?: string | null
    }
}

export enum TraceSpanStatus {
    UNSET = "UNSET",
    OK = "OK",
    ERROR = "ERROR",
}

export type TraceSpanMetadata = {
    cost?: number | null
    latency?: number | null
    usage?: {
        completion_tokens: number
        prompt_tokens: number
        total_tokens: number
    } | null
}

export interface TraceSpanDetails extends TraceSpan {
    config?: GenericObject
}

export interface TraceSpanTreeNode {
    title: React.ReactElement
    key: string
    children?: TraceSpanTreeNode[]
}

interface VariantVotesData {
    number_of_votes: number
    percentage: number
}
export interface HumanEvaluationListTableDataType {
    key: string
    variants: string[]
    testset: {
        _id: string
        name: string
    }
    evaluationType: string
    status: EvaluationFlow
    votesData: {
        nb_of_rows: number
        variants: string[]
        flag_votes: {
            number_of_votes: number
            percentage: number
        }
        positive_votes: {
            number_of_votes: number
            percentage: number
        }
        variants_votes_data: Record<string, VariantVotesData>
    }
    createdAt: string
    revisions: string[]
    variant_revision_ids: string[]
    variantNames: string[]
}

export type Filter = {
    key: string
    operator: FilterConditions
    value: string
    isPermanent?: boolean
}

export type FilterConditions =
    | "contains"
    | "matches"
    | "like"
    | "startswith"
    | "endswith"
    | "exists"
    | "not_exists"
    | "eq"
    | "neq"
    | "gt"
    | "lt"
    | "gte"
    | "lte"
    | "between"
    | "in"
    | "is"
    | "is_not"
    | "btwn"
    | ""

export interface WorkspaceRole {
    role_description: string
    role_name: string
}

export interface WorkspaceUser {
    id: string
    email: string
    username: string
    status: "member" | "pending" | "expired"
    created_at: string
}

export interface WorkspaceMember {
    user: WorkspaceUser
    roles: (WorkspaceRole & {permissions: string[]})[]
}

export interface Workspace {
    id: string
    name: string
    description: string
    created_at: string
    updated_at: string
    organization: string
    type: "default"
    members: WorkspaceMember[]
}

export interface Org {
    id: string
    name: string
    description: string
    owner: string
    is_paying: boolean
}

export type OrgDetails = Org & {
    type: "default"
    default_workspace: Workspace
    workspaces: string[]
}
