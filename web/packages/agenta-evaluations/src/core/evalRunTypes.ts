/**
 * @agenta/evaluations/core — eval-run step & trace types.
 *
 * Relocated verbatim from OSS (`@/oss/lib/evaluations/types.ts`) during the WP-4e-1
 * seam scaffold. These are pure data-shape types (no jotai / React / network), describing
 * the snake_case step/trace payloads the eval-run view reads plus their camelCase
 * derivatives.
 *
 * Three former OSS-local deps are resolved here:
 *   - `SnakeToCamelCaseKeys` now comes from `@agenta/shared/types`.
 *   - `PreviewTestset` / `PreviewTestCase` are defined locally (the testcase row shape the
 *     input step carries), mirroring the preview-eval shape promoted in WP-4c.
 *   - `AnnotationDto` (a pure data-shape type) is ported locally below.
 */
import type {SnakeToCamelCaseKeys} from "@agenta/shared/types"
import {SWRConfiguration, SWRResponse} from "swr"

// ─────────────────────────────────────────────────────────────────────────────
// Ported annotation data-shape types (from `@/oss/lib/hooks/useAnnotations/types`).
// Pure data-shape — no runtime / state coupling. Kept local so the package stays
// free of any `@/oss` import.
// ─────────────────────────────────────────────────────────────────────────────

interface AnnotationLink {
    trace_id?: string
    span_id?: string
    attributes?: Record<string, unknown>
}

interface AnnotationReference {
    id?: string
    slug?: string
    version?: number
    attributes?: Record<string, unknown>
}

interface AnnotationReferences {
    evaluator: AnnotationReference
    evaluator_revision?: AnnotationReference
    testset?: AnnotationReference
    testcase?: AnnotationReference
}

interface AnnotationMetadata {
    name: string
    description: string
    tags: string[]
}

type AnnotationKind = "adhoc" | "eval"
type AnnotationChannel = "web" | "sdk" | "api"
type AnnotationOrigin = "custom" | "human" | "auto"

type AnnotationLinks = Record<string, AnnotationLink>

// Depth-limited JSON type to prevent TypeScript infinite recursion errors (see TS issue #34933)
type Prev = [never, 0, 1, 2, 3, 4]
export type FullJsonRec<Depth extends number = 4> = Depth extends 0
    ? unknown // base case: stop recursion
    :
          | string
          | number
          | boolean
          | null
          | {[key: string]: FullJsonRec<Prev[Depth]>}
          | FullJsonRec<Prev[Depth]>[]

export type FullJson = FullJsonRec<4>

interface BaseAnnotationDto {
    trace_id?: string
    span_id?: string
    link?: AnnotationLink
    data: {
        outputs?: Record<string, FullJson>
    }
    references?: AnnotationReferences
    links?: AnnotationLinks
    channel?: AnnotationChannel
    kind?: AnnotationKind
    origin?: AnnotationOrigin
    meta?: AnnotationMetadata
}

export interface AnnotationDto extends BaseAnnotationDto {
    createdAt?: string
    createdBy?: string
    createdById?: string
    // Added uuid to generate unique id for each annotation in the annotations table
    id?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview-testset shapes the input step reads. Mirrors the WP-4c preview-eval shape
// (`hooks/usePreviewEvaluations/previewTypes`) but kept local to this module so the
// trace/step types have no cross-module coupling.
// ─────────────────────────────────────────────────────────────────────────────

export interface PreviewTestCase {
    testcase_id: string
    __flags__?: unknown
    __tags__?: unknown
    __meta__?: unknown
    [key: string]: unknown
}

export interface PreviewTestset {
    id: string
    name: string
    created_at: string
    created_by_id: string
    slug: string
    data: {
        testcase_ids: string[]
        testcases: PreviewTestCase[]
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Response Types (snake_case from API)
// ─────────────────────────────────────────────────────────────────────────────
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
    error?: Record<string, unknown>
    created_at?: string
    created_by_id?: string
    is_legacy?: boolean
    inputs?: Record<string, unknown>
    ground_truth?: Record<string, unknown>
}

/** Step response in camelCase (derived from StepResponseStep) */
export type IStepResponse = SnakeToCamelCaseKeys<StepResponseStep>

// ─────────────────────────────────────────────────────────────────────────────
// Trace Types
// ─────────────────────────────────────────────────────────────────────────────
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
    data: Record<string, unknown>
    metrics: Record<string, unknown>
    refs: Record<string, unknown>
    otel: {
        kind: string
        attributes: Record<string, unknown>
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

// ─────────────────────────────────────────────────────────────────────────────
// Invocation Types
// ─────────────────────────────────────────────────────────────────────────────
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
                        tools: unknown[]
                    }
                }
            }
            inputs: Record<string, unknown>
        }
        endpoint: string
    } | null
>

// ─────────────────────────────────────────────────────────────────────────────
// Extended Step Types
// ─────────────────────────────────────────────────────────────────────────────
export interface IInvocationStep extends IStepResponse {
    trace?: TraceTree
    invocationParameters?: InvocationParameters
}

export interface IInputStep extends IStepResponse {
    inputs?: Record<string, unknown>
    groundTruth?: Record<string, unknown>
    testcase?: PreviewTestCase
}

export interface IAnnotationStep extends IStepResponse {
    annotation?: AnnotationDto
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook-specific Types
// ─────────────────────────────────────────────────────────────────────────────
export interface UseEvaluationRunScenarioStepsOptions {
    limit?: number
    next?: string
    keys?: string[]
    statuses?: string[]
}

export interface UseEvaluationRunScenarioStepsResult {
    isLoading: boolean
    swrData: SWRResponse<UseEvaluationRunScenarioStepsFetcherResult[], unknown>
    mutate: () => Promise<unknown>
}

export interface UseEvaluationRunScenarioStepsConfig extends SWRConfiguration {
    concurrency?: number
}

export interface UseEvaluationRunScenarioStepsFetcherResult {
    steps: IStepResponse[]
    mappings?: unknown[]
    annotationSteps: IAnnotationStep[]
    invocationSteps: IInvocationStep[]
    inputSteps: IInputStep[]
    annotations?: AnnotationDto[] | null
    inputStep?: IStepResponse
    scenarioId?: string
    trace?: TraceTree | TraceData | null
    invocationParameters?: InvocationParameters
}
