/**
 * Generic metric/schema-extraction types for the evaluations engine.
 *
 * Relocated faithfully from `@agenta/annotation`'s form controller / types,
 * adapting only the kind-agnostic naming (`AnnotationMetricField` → `MetricField`,
 * `AnnotationMetrics` → `MetricsByEvaluator`). The structures are identical.
 */

import type {Workflow} from "@agenta/entities/workflow"

import type {EvaluatorStepRef} from "../scenarioData/types"

/**
 * A single metric field with value and schema metadata.
 *
 * Relocated from `AnnotationMetricField` (annotation/types.ts).
 */
export interface MetricField {
    value: unknown
    type?: string | string[]
    minimum?: number
    maximum?: number
    enum?: unknown[]
    items?: {
        type?: string
        enum?: string[]
    }
    [key: string]: unknown
}

/**
 * Metrics grouped by evaluator slug, then by field key.
 *
 * Relocated from `AnnotationMetrics` (annotation/types.ts).
 */
export type MetricsByEvaluator = Record<string, Record<string, MetricField>>

/**
 * Evaluator resolution status.
 */
export interface EvaluatorResolutionState {
    isPending: boolean
    hasError: boolean
}

interface ResolvedEvaluatorRef {
    workflowId: string | null
    variantId: string | null
    revisionId: string | null
    stepKey: string | null
    evaluator: Workflow
}

interface ResolvedEvaluators {
    evaluators: Workflow[]
    resolvedRefs: ResolvedEvaluatorRef[]
    evaluatorResolution: EvaluatorResolutionState
}

interface BaselineComputationResult extends ResolvedEvaluators {
    baseline: MetricsByEvaluator
}

export type {EvaluatorStepRef, ResolvedEvaluatorRef, ResolvedEvaluators, BaselineComputationResult}
