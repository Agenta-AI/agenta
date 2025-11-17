import type {GlobalToken} from "antd"
import type {StaticImageData} from "next/image"

import type {AgentaNodeDTO} from "@/oss/services/observability/types"

import type {EvaluationFlow, EvaluationType} from "./enums"
import {VariantParameters} from "./shared/variant/transformer/types"

// Type utility to convert snake_case object properties to camelCase
export type SnakeToCamelCaseKeys<T> = T extends readonly any[]
    ? T extends [infer First, ...infer Rest]
        ? [SnakeToCamelCaseKeys<First>, ...SnakeToCamelCaseKeys<Rest>]
        : T extends (infer U)[]
          ? SnakeToCamelCaseKeys<U>[]
          : T
    : T extends object
      ? {
            [K in keyof T as SnakeToCamelCase<K & string>]: SnakeToCamelCaseKeys<T[K]>
        }
      : T

export type SnakeToCamelCase<S extends string> = S extends `${infer T}_${infer U}`
    ? `${T}${Capitalize<SnakeToCamelCase<U>>}`
    : S

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

export type JSSTheme = GlobalToken & {isDark: boolean; fontWeightMedium: number}

export interface testset {
    _id: string
    name: string
    created_at: string
    updated_at: string
}

export interface Testset {
    id: string
    name: string
    created_at: string
    updated_at: string
    csvdata: KeyValuePair[]
}

export interface PreviewTestcase {
    created_at: string
    created_by_id: string

    id: string
    set_id: string
    testset_id: string
    data: Record<string, any>
}

export interface PreviewTestset {
    id: string
    name: string
    created_at: string
    created_by_id: string
    slug: string
    data: {
        testcase_ids: string[]
        testcases: {
            testcase_id: string
            __flags__?: any
            __tags__?: any
            __meta__?: any
            [key: string]: any
        }[]
    }
}

export type TestsetCreationMode = "create" | "clone" | "rename"

export interface ListAppsItem {
    app_id: string
    app_name: string
    app_type?: string
    created_at?: string
    updated_at: string
}

export type APP_TYPE = "completion" | "chat" | "custom"

export interface AppVariant {
    id: number
    name: string
    endpoint: string
}

export interface ApiVariant {
    app_id: string
    app_name: string
    variant_id: string
    variant_name: string
    project_id: string
    parameters: Record<string, unknown>
    base_name: string
    base_id: string
    config_name: string
    uri: string
    revision: number
    created_at: string
    updated_at: string
    modified_by_id: string
}

export interface ApiRevision {
    id: string
    revision: number
    modified_by: string
    config: {
        config_name: string
        parameters: Record<string, unknown>
    }
    created_at: string
    commit_message: string | null
}

export interface VariantRevision extends SnakeToCamelCaseKeys<ApiRevision> {
    variantId: string
    deployedIn?: CamelCaseEnvironment[]
    createdAtTimestamp: number
    updatedAtTimestamp: number
    isLatestRevision: boolean
}

export type CamelCaseEnvironment = SnakeToCamelCaseKeys<Environment>

export interface Variant extends Omit<SnakeToCamelCaseKeys<ApiVariant>, "parameters"> {
    appId: string
    name: string
    templateVariantName: string | null // template name of the variant in case it has a precursor. Needed to compute the URI path
    persistent: boolean // whether the variant is persistent in the backend or not
    previousVariantName?: null | string // name of the variant that was forked from. Only set in the case of forked variants
    variantId: string
    id: string
    // updatedAt: string
    // createdAt: string
    modifiedBy: string
    revisions?: VariantRevision[]
    deployedIn?: CamelCaseEnvironment[] // environments where this variant is deployed
    parameters: VariantParameters
    createdAtTimestamp: number
    updatedAtTimestamp: number
    isLatestRevision: boolean
    commitMessage: string | null
    // parameters: Record<string, string> | null // parameters of the variant. Only set in the case of forked variants
    // uri?: string
}

// Define the interface for the tabs item in playground page
export interface PlaygroundTabsItem {
    key: string
    label: string
    children: React.JSX.Element
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
    createdAtTimestamp: number
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
    } & Testset
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
        variants_votes_data: Record<
            string,
            {
                number_of_votes: number
                percentage: number
            }
        >
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
    inputs: object[]
    outputs: object[]
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
    inputs: object[]
    outputs: object[]
    evaluation_prompt_template: string
    open_ai_key: string
}

export interface Parameter {
    name: string
    type: string
    input: boolean
    required: boolean
    default?: any
    enum?: string[]
    minimum?: number
    maximum?: number
    choices?: Record<string, string[]>
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

export interface LanguageItem {
    displayName: string
    languageKey: string
}

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

export interface HeaderDTO {
    name?: string | null
    description?: string | null
}

export interface StandardSecret {
    kind: SecretDTOProvider
    provider: {
        key: string
    }
}

export type StandardSecretDTO<T extends "payload" | "response" = "response"> = {
    header: HeaderDTO
} & (T extends "payload"
    ? {secret: {data: StandardSecret; kind: SecretDTOKind.PROVIDER_KEY}}
    : {
          kind: SecretDTOKind.PROVIDER_KEY
          data: StandardSecret
          id: string
          lifecycle: {created_at: string}
      })

export enum SecretDTOKind {
    PROVIDER_KEY = "provider_key",
    CUSTOM_PROVIDER_KEY = "custom_provider",
}

export enum SecretDTOProvider {
    OPENAI = "openai",
    COHERE = "cohere",
    ANYSCALE = "anyscale",
    DEEPINFRA = "deepinfra",
    ALEPHALPHA = "alephalpha",
    GROQ = "groq",
    MISTRALAI = "mistral",
    ANTHROPIC = "anthropic",
    PERPLEXITYAI = "perplexityai",
    TOGETHERAI = "together_ai",
    OPENROUTER = "openrouter",
    GEMINI = "gemini",
}

export const PROVIDER_LABELS: Record<string, string> = {
    openai: "OpenAI",
    cohere: "Cohere",
    anyscale: "Anyscale",
    deepinfra: "DeepInfra",
    alephalpha: "Aleph Alpha",
    groq: "Groq",
    mistral: "Mistral AI",
    anthropic: "Anthropic",
    perplexityai: "Perplexity AI",
    together_ai: "Together AI",
    openrouter: "OpenRouter",
    gemini: "Google Gemini",
    vertex_ai: "Google Vertex AI",
    bedrock: "AWS Bedrock",
    // sagemaker: "AWS SageMaker",
    azure: "Azure OpenAI",
    custom: "Custom Provider",
}

export const PROVIDER_KINDS: Record<string, string> = Object.entries(PROVIDER_LABELS).reduce(
    (acc, [kind, label]) => {
        acc[kind] = kind
        acc[label.toLowerCase()] = kind
        return acc
    },
    {} as Record<string, string>,
)

interface VaultModels {
    slug: string
}
interface VaultProvider {
    url: string
    version: string
    extras: {
        aws_access_key_id?: string
        aws_secret_access_key?: string
        aws_session_token?: string
        aws_region_name?: string
        vertex_ai_project?: string
        vertex_ai_location?: string
        vertex_ai_credentials?: string
        api_key?: string
    }
}

interface VaultData {
    kind: string
    provider: VaultProvider
    models: VaultModels[]
    model_keys: string[]
    provider_slug: string
}

export type CustomSecretDTO<T extends "payload" | "response" = "response"> = {
    header: HeaderDTO
} & (T extends "payload"
    ? {secret: {kind: SecretDTOKind.CUSTOM_PROVIDER_KEY; data: VaultData}}
    : {
          kind: SecretDTOKind.CUSTOM_PROVIDER_KEY
          data: VaultData
          id: string
          lifecycle: {created_at: string}
      })

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

export interface VariantVotesData {
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

export type FilterValue =
    | string
    | number
    | boolean
    | Record<string, any>
    | Array<string | number | boolean | Record<string, any>>

export interface Filter {
    field: string
    key?: string
    operator: FilterConditions
    value: FilterValue
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
    | "not_in"
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

export interface AuthErrorMsgType {
    message: string
    sub?: string
    type: "error" | "success" | "info" | "warning" | undefined
}

export interface APIKey {
    prefix: string
    created_at: string
    last_used_at: string
    expiration_date: string | null
}

export interface SingleModelEvaluationListTableDataType {
    id: string
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
    resultsData: Record<string, number>
    createdAt: string
    revisions: string[]
    variant_revision_ids: string[]
}

export interface FuncResponse {
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

export interface BaseResponseSpans {
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

export interface TraceSpanMetadata {
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
} & Record<string, any>

export interface RequestMetadata {
    cost: number
    latency: number
    usage:
        | {completion?: number; prompt?: number; total: number}
        | {completion_tokens?: number; prompt_tokens?: number; total_tokens: number}
}

export interface WithPagination<T> {
    data: T[]
    total: number
    page: number
    pageSize: number
}

export interface PaginationQuery {
    page: number
    pageSize: number
}

export interface StyleProps {
    themeMode: "dark" | "light"
}

export interface SettingsPreset {
    key: string
    name: string
    values: Record<string, any>
}

export interface Evaluator {
    name: string
    key: string
    settings_presets?: SettingsPreset[]
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

export interface EvaluationError {
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
    RUNNING = "running",
    SUCCESS = "success",
    FAILURE = "failure",
    FAILED = "failed",
    ERRORS = "errors",
    CANCELLED = "cancelled",
    PENDING = "pending",
    INCOMPLETE = "incomplete",
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
    | "llm_response_schema"

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

export interface ChatImageURL {
    url: string
    detail?: "auto" | "low" | "high"
}

export interface ChatMessageContentText {
    type: "text"
    text: string
}

export interface ChatMessageContentImage {
    type: "image_url"
    image_url: ChatImageURL
}

export type ChatMessageContent = string | (ChatMessageContentText | ChatMessageContentImage)[]

export interface ChatMessage {
    role: ChatRole
    content: ChatMessageContent
    id?: string
}

// billings
export enum Plan {
    Hobby = "cloud_v0_hobby",
    Pro = "cloud_v0_pro",
    Business = "cloud_v0_business",
    Enterprise = "cloud_v0_enterprise",
}

export interface DeploymentRevisionConfig {
    config_name: string
    current_version: number
    parameters: Record<string, any>
}

export interface DeploymentRevision {
    created_at: string
    deployed_app_variant_revision: string
    deployment: string
    id: string
    deployed_variant_name: string | null
    modified_by: string
    revision: number
    commit_message: string | null
}

export interface DeploymentRevisions extends Environment {
    revisions: DeploymentRevision[]
}
