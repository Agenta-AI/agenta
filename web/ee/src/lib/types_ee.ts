import {GenericObject, RequestMetadata} from "@/oss/lib/Types"
import {Environment, IPromptRevisions} from "@/oss/lib/Types"

export enum GenerationStatus {
    UNSET = "UNSET",
    OK = "OK",
    ERROR = "ERROR",
}

export enum GenerationKind {
    TOOL = "TOOL",
    CHAIN = "CHAIN",
    LLM = "LLM",
    WORKFLOW = "WORKFLOW",
    RETRIEVER = "RETRIEVER",
    EMBEDDING = "EMBEDDING",
    AGENT = "AGENT",
    UNKNOWN = "UNKNOWN",
}

export interface Generation {
    id: string
    created_at: string
    variant: {
        variant_id: string
        variant_name: string
        revision: number
    }
    environment: string | null
    status: GenerationStatus
    error?: string
    spankind: GenerationKind
    metadata?: RequestMetadata
    user_id?: string
    children?: []
    parent_span_id?: string
    name?: string
    content: {
        inputs: Record<string, any>
        internals: Record<string, any>
        outputs: string[] | Record<string, any>
    }
}

export interface GenerationTreeNode {
    title: React.ReactElement
    key: string
    children?: GenerationTreeNode[]
}

export interface GenerationDetails extends Generation {
    config: GenericObject
}

export interface GenerationDashboardData {
    data: {
        timestamp: number | string
        success_count: number
        failure_count: number
        cost: number
        latency: number
        total_tokens: number
        prompt_tokens: number
        completion_tokens: number
        enviornment: string
        variant: string
    }[]
    total_count: number
    failure_rate: number
    total_cost: number
    avg_cost: number
    avg_latency: number
    total_tokens: number
    avg_tokens: number
}

export interface Trace extends Generation {}

export interface TraceDetails extends GenerationDetails {
    spans: Generation[]
}

export interface DeploymentRevisionConfig {
    config_name: string
    current_version: number
    parameters: Record<string, any>
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
    parameters: Record<string, any>
    previous_variant_name: string | null
    revision: number
    revisions: [IPromptRevisions]
    uri: string
    user_id: string
    variant_id: string
    variant_name: string
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

export interface EvaluatorMappingInput {
    inputs: Record<string, any>
    mapping: Record<string, any>
}

export interface EvaluatorMappingOutput {
    outputs: Record<string, any>
}

export interface EvaluatorInputInterface {
    inputs: Record<string, any>
    settings?: Record<string, any>
    credentials?: Record<string, any>
}

export interface EvaluatorOutputInterface {
    outputs: Record<string, any>
}
