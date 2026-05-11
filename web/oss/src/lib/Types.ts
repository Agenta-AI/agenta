import type {GlobalToken} from "antd"
import type {StaticImageData} from "next/image"

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
    _id?: string
    id?: string
    name: string
    created_at: string
    updated_at: string
    created_by_id?: string
    columns?: string[]
}

export interface Testset {
    id: string
    name: string
    created_at: string
    updated_at: string
    csvdata: KeyValuePair[]
    columns?: string[]
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

export interface LLMRunRateLimit {
    batch_size: number
    max_retries: number
    retry_delay: number
    delay_between_batches: number
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

export interface LanguageItem {
    displayName: string
    languageKey: string
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
    MISTRAL = "mistral",
    ANTHROPIC = "anthropic",
    PERPLEXITYAI = "perplexityai",
    TOGETHERAI = "together_ai",
    OPENROUTER = "openrouter",
    GEMINI = "gemini",
    MINIMAX = "minimax",
}

export const PROVIDER_LABELS: Record<string, string> = {
    openai: "OpenAI",
    cohere: "Cohere",
    anyscale: "Anyscale",
    deepinfra: "DeepInfra",
    alephalpha: "Aleph Alpha",
    groq: "Groq",
    mistral: "Mistral AI",
    mistralai: "Mistral AI",
    anthropic: "Anthropic",
    perplexityai: "Perplexity AI",
    together_ai: "Together AI",
    openrouter: "OpenRouter",
    gemini: "Google Gemini",
    vertex_ai: "Google Vertex AI",
    bedrock: "AWS Bedrock",
    azure: "Azure OpenAI",
    minimax: "MiniMax",
    custom: "Custom Provider",
}

export const PROVIDER_KINDS: Record<string, string> = {
    ...Object.entries(PROVIDER_LABELS).reduce(
        (acc, [kind, label]) => {
            acc[kind] = kind
            acc[label.toLowerCase()] = kind
            return acc
        },
        {} as Record<string, string>,
    ),
    // Normalize legacy "mistralai" slug to canonical "mistral"
    mistralai: "mistral",
}

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

export type GenericObject = Record<string, any>
export type KeyValuePair = Record<string, string>

export interface Environment {
    name: string
    app_id: string
    deployed_app_variant_id: string | null
    deployed_variant_name: string | null
    deployed_app_variant_revision_id: string | null
    revision: string | null
    updated_at?: string | null
}

export type FilterValue =
    | string
    | number
    | boolean
    | Record<string, any>
    | (string | number | boolean | Record<string, any>)[]

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

export interface OrganizationFlags {
    is_demo: boolean
    is_personal: boolean
    allow_email: boolean
    allow_social: boolean
    allow_sso: boolean
    allow_root: boolean
    domains_only: boolean
    auto_join: boolean
}

export interface Org {
    id: string
    slug?: string
    name?: string
    description?: string
    flags: OrganizationFlags
    owner_id: string
}

export type OrgDetails = Org & {
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

export interface RequestMetadata {
    cost: number
    latency: number
    usage:
        | {completion?: number; prompt?: number; total: number}
        | {completion_tokens?: number; prompt_tokens?: number; total_tokens: number}
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
    outputs_schema?: Record<string, any>
    icon_url?: string | StaticImageData
    color?: string
    direct_use?: boolean
    description: string
    oss?: boolean
    requires_llm_api_keys?: boolean
    tags: string[]
    archived?: boolean
}

export interface SimpleEvaluator {
    id: string
    slug: string
    name?: string
    description?: string
    tags?: string[]
    meta?: Record<string, any>
    flags?: SimpleEvaluatorFlags
    data?: SimpleEvaluatorData
    created_at?: string
    updated_at?: string
    deleted_at?: string | null
    created_by_id?: string
    updated_by_id?: string
    deleted_by_id?: string
    color?: string
    icon_url?: string | StaticImageData
}

interface SimpleEvaluatorData {
    version?: string
    uri?: string
    url?: string
    headers?: Record<string, string>
    schemas?: Record<string, any>
    script?: {content?: string; runtime?: string}
    parameters?: Record<string, any>
    service?: Record<string, any>
    configuration?: Record<string, any>
}

interface SimpleEvaluatorFlags {
    is_custom?: boolean
    is_evaluator?: boolean
    is_feedback?: boolean
    requires_llm_api_keys?: boolean
    evaluator_key?: string
    color?: string
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
    | "fields_checkbox_list"

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

export interface User {
    id: string
    uid: string
    username: string
    email: string
}

// billings
export enum Plan {
    Hobby = "cloud_v0_hobby",
    Pro = "cloud_v0_pro",
    Business = "cloud_v0_business",
    Enterprise = "cloud_v0_enterprise",
    SelfHostedEnterprise = "self_hosted_enterprise",
}
