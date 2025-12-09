/**
 * Export metadata types for scenario table columns
 */

import type {EvaluationTableColumn} from "../atoms/table"

/**
 * Meta column export descriptor (e.g., scenario index, status, timestamp)
 */
export interface MetaColumnExportMetadata {
    type: "meta"
    columnId: string
}

/**
 * Input column export descriptor (testcase inputs)
 */
export interface InputColumnExportMetadata {
    type: "input"
    columnId: string
    stepKey?: string
    path: string
    pathSegments?: string[]
}

/**
 * Invocation column export descriptor (LLM outputs)
 */
export interface InvocationColumnExportMetadata {
    type: "invocation"
    columnId: string
    stepKey?: string
    path: string
    pathSegments?: string[]
}

/**
 * Metric column export descriptor (evaluation results)
 */
export interface MetricColumnExportMetadata {
    type: "metric"
    columnId: string
    stepKey?: string
    path: string
    metricKey?: string
    metricType?: string
    groupLabel?: string
    evaluatorId?: string
    evaluatorSlug?: string
}

export type ScenarioColumnExportMetadata =
    | MetaColumnExportMetadata
    | InputColumnExportMetadata
    | InvocationColumnExportMetadata
    | MetricColumnExportMetadata

/**
 * Build export metadata for a scenario column
 */
export const buildExportMetadata = (column: EvaluationTableColumn): ScenarioColumnExportMetadata => {
    const columnId = column.id

    // Meta columns (status, timestamp, etc.)
    if (column.stepType === "meta") {
        return {
            type: "meta",
            columnId,
        }
    }

    // Input columns (testcase inputs)
    if (column.stepType === "input") {
        return {
            type: "input",
            columnId,
            stepKey: column.stepKey,
            path: column.path,
            pathSegments: column.pathSegments,
        }
    }

    // Invocation columns (LLM outputs)
    if (column.stepType === "invocation") {
        return {
            type: "invocation",
            columnId,
            stepKey: column.stepKey,
            path: column.path,
            pathSegments: column.pathSegments,
        }
    }

    // Metric columns (evaluation results)
    if (column.stepType === "annotation" || column.kind === "metric") {
        return {
            type: "metric",
            columnId,
            stepKey: column.stepKey,
            path: column.path,
            metricKey: column.metricKey,
            metricType: column.metricType,
            evaluatorId: column.evaluatorId,
            evaluatorSlug: column.evaluatorSlug,
        }
    }

    // Default to meta for unknown types
    return {
        type: "meta",
        columnId,
    }
}
