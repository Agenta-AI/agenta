import {SWRResponse, SWRConfiguration} from "swr"

import type {PreviewTestSet, SnakeToCamelCaseKeys} from "../../Types"
import {AnnotationDto} from "../useAnnotations/types"
import {RunIndex} from "../useEvaluationRunData/assets/helpers/buildRunIndex"

// Step type for useEvaluationRunScenarioSteps fetcher result (camelCase, derived from StepResponseStep)
// Options for fetching steps (pagination, filters)
export interface UseEvaluationRunScenarioStepsOptions {
    limit?: number
    next?: string
    keys?: string[]
    statuses?: string[]
}

// Result type returned by the hook
export interface UseEvaluationRunScenarioStepsResult {
    isLoading: boolean
    swrData: SWRResponse<UseEvaluationRunScenarioStepsFetcherResult[], any>
    // Function to revalidate
    mutate: () => Promise<any>
}

export interface UseEvaluationRunScenarioStepsConfig extends SWRConfiguration {
    concurrency?: number
}

// --- Types for useEvaluationRunScenarioSteps fetcher result ---
export interface StepResponse {
    steps: StepResponseStep[]
    count: number
    next?: string
}
export interface StepResponseStep {
    id: string
    //
    run_id: string
    scenario_id: string
    step_key: string
    repeat_idx?: number
    timestamp?: string
    interval?: number
    //
    status: string
    //
    // hash_id?: string
    trace_id?: string
    testcase_id?: string
    error?: Record<string, any>
    //
    created_at?: string
    created_by_id?: string
    //
    is_legacy?: boolean
    inputs?: Record<string, any>
    ground_truth?: Record<string, any>
}
export type IStepResponse = SnakeToCamelCaseKeys<StepResponseStep>

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

export interface IInvocationStep extends IStepResponse {
    trace?: TraceTree
    invocationParameters?: InvocationParameters
}

export interface IInputStep extends IStepResponse {
    inputs?: Record<string, any>
    groundTruth?: Record<string, any>
    testcase?: PreviewTestSet["data"]["testcases"][number]
}
export interface IAnnotationStep extends IStepResponse {
    annotation?: AnnotationDto
}

export interface UseEvaluationRunScenarioStepsFetcherResult {
    steps: IStepResponse[]
    mappings?: any[]

    // Single primary steps (kept for backward compatibility)
    // invocationStep?: IStepResponse
    annotationSteps: IAnnotationStep[]
    invocationSteps: IInvocationStep[]
    inputSteps: IInputStep[]
    annotations?: AnnotationDto[] | null

    // NEW: support multiple role steps per scenario
    inputStep?: IStepResponse
    scenarioId?: string
    trace?: TraceTree | TraceData | null
    // annotation?: AnnotationDto | null
    invocationParameters?: InvocationParameters
}
