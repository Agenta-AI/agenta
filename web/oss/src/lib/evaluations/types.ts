import {SWRConfiguration, SWRResponse} from "swr"

import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import type {PreviewTestset, SnakeToCamelCaseKeys} from "@/oss/lib/Types"

// --- Step Response Types (snake_case from API) ---
export interface StepResponse {
    steps: StepResponseStep[]
    count: number
    next?: string
}

export interface StepResponseStep {
    id: string
    run_id: string
    scenario_id: string
    step_key: string
    repeat_idx?: number
    timestamp?: string
    interval?: number
    status: string
    trace_id?: string
    testcase_id?: string
    error?: Record<string, any>
    created_at?: string
    created_by_id?: string
    is_legacy?: boolean
    inputs?: Record<string, any>
    ground_truth?: Record<string, any>
}

/** Step response in camelCase (derived from StepResponseStep) */
export type IStepResponse = SnakeToCamelCaseKeys<StepResponseStep>

// --- Trace Types ---
export interface TraceNode {
    trace_id: string
    span_id: string
    lifecycle: {
        created_at: string
    }
    root: {
        id: string
    }
    tree: {
        id: string
    }
    node: {
        id: string
        name: string
        type: string
    }
    parent?: {
        id: string
    }
    time: {
        start: string
        end: string
    }
    status: {
        code: string
    }
    data: Record<string, any>
    metrics: Record<string, any>
    refs: Record<string, any>
    otel: {
        kind: string
        attributes: Record<string, any>
    }
    nodes?: Record<string, TraceNode>
}

export interface TraceData {
    trees: TraceTree[]
    version: string
    count: number
}

export interface TraceTree {
    tree: {
        id: string
    }
    nodes: TraceNode[]
}

// --- Invocation Types ---
export type InvocationParameters = Record<
    string,
    {
        requestBody: {
            ag_config: {
                prompt: {
                    messages: {role: string; content: string}[]
                    template_format: string
                    input_keys: string[]
                    llm_config: {
                        model: string
                        tools: any[]
                    }
                }
            }
            inputs: Record<string, any>
        }
        endpoint: string
    } | null
>

// --- Extended Step Types ---
export interface IInvocationStep extends IStepResponse {
    trace?: TraceTree
    invocationParameters?: InvocationParameters
}

export interface IInputStep extends IStepResponse {
    inputs?: Record<string, any>
    groundTruth?: Record<string, any>
    testcase?: PreviewTestset["data"]["testcases"][number]
}

export interface IAnnotationStep extends IStepResponse {
    annotation?: AnnotationDto
}

// --- Hook-specific Types ---
export interface UseEvaluationRunScenarioStepsOptions {
    limit?: number
    next?: string
    keys?: string[]
    statuses?: string[]
}

export interface UseEvaluationRunScenarioStepsResult {
    isLoading: boolean
    swrData: SWRResponse<UseEvaluationRunScenarioStepsFetcherResult[], any>
    mutate: () => Promise<any>
}

export interface UseEvaluationRunScenarioStepsConfig extends SWRConfiguration {
    concurrency?: number
}

export interface UseEvaluationRunScenarioStepsFetcherResult {
    steps: IStepResponse[]
    mappings?: any[]
    annotationSteps: IAnnotationStep[]
    invocationSteps: IInvocationStep[]
    inputSteps: IInputStep[]
    annotations?: AnnotationDto[] | null
    inputStep?: IStepResponse
    scenarioId?: string
    trace?: TraceTree | TraceData | null
    invocationParameters?: InvocationParameters
}
