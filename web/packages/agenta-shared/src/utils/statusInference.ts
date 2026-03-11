/**
 * Status Inference Utilities
 *
 * Pure functions for inferring execution status from trace/span data.
 * These are framework-agnostic and can be used across packages.
 */

import {getValueAtStringPath} from "./pathUtils"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Possible execution status values
 */
export type ExecutionStatus = "Success" | "Error" | "Unset"

/**
 * Summary data shape for status inference
 */
export interface ExecutionSummary {
    rootSpan: Record<string, unknown> | null
    agData: Record<string, unknown> | null
    metrics: {
        durationMs?: number
        totalTokens?: number
        totalCost?: number
    }
}

// ============================================================================
// NUMBER COERCION
// ============================================================================

/**
 * Coerce an unknown value to a finite number, or return null.
 *
 * Handles:
 * - Finite numbers (returned as-is)
 * - Numeric strings (parsed)
 * - Objects with a `.total` property (e.g. `{ total: 42 }`)
 */
export function toFiniteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }
    if (value && typeof value === "object") {
        const total = (value as Record<string, unknown>).total
        if (typeof total === "number" && Number.isFinite(total)) return total
    }
    return null
}

// ============================================================================
// STATUS LABEL MAPPING
// ============================================================================

/**
 * Map a status code string (e.g. from OpenTelemetry) to a display label.
 */
export function getStatusLabel(status?: string): ExecutionStatus | null {
    if (!status) return null
    if (status === "STATUS_CODE_OK") return "Success"
    if (status === "STATUS_CODE_ERROR") return "Error"
    if (status === "STATUS_CODE_UNSET") return "Unset"
    return null
}

export type StatusSeverity = "success" | "error" | "default"

/**
 * Map an execution status to a semantic severity level.
 */
export function getStatusSeverity(status: ExecutionStatus): StatusSeverity {
    if (status === "Success") return "success"
    if (status === "Error") return "error"
    return "default"
}

/**
 * @deprecated Use `getStatusSeverity` instead. This alias exists for backwards compatibility.
 */
export const getStatusColor = getStatusSeverity

// ============================================================================
// STATUS INFERENCE
// ============================================================================

/**
 * Infer execution status from a summary object by inspecting error metrics,
 * explicit error fields, output presence, and metric availability.
 */
export function inferStatusFromSummary(summary: ExecutionSummary): ExecutionStatus {
    const sources: Record<string, unknown>[] = []
    if (summary.rootSpan) sources.push(summary.rootSpan)
    if (summary.agData) sources.push(summary.agData)
    if (summary.rootSpan?.attributes && typeof summary.rootSpan.attributes === "object") {
        sources.push(summary.rootSpan.attributes as Record<string, unknown>)
    }

    const errorMetricPaths = [
        "metrics.errors.cumulative.total",
        "metrics.errors.total",
        "ag.metrics.errors.cumulative.total",
    ]

    for (const source of sources) {
        for (const path of errorMetricPaths) {
            const value = getValueAtStringPath(source, path)
            const num = toFiniteNumber(value)
            if (num !== null && num > 0) return "Error"
        }
        const explicitError =
            getValueAtStringPath(source, "error") ??
            getValueAtStringPath(source, "errors") ??
            getValueAtStringPath(source, "data.error") ??
            getValueAtStringPath(source, "data.errors")
        if (explicitError) return "Error"
    }

    for (const source of sources) {
        const hasOutputs =
            getValueAtStringPath(source, "data.outputs") ??
            getValueAtStringPath(source, "outputs") ??
            getValueAtStringPath(source, "data.output") ??
            getValueAtStringPath(source, "output")
        if (hasOutputs) return "Success"
    }

    const hasUsefulMetrics = Boolean(
        summary.metrics.durationMs !== undefined ||
        summary.metrics.totalTokens !== undefined ||
        summary.metrics.totalCost !== undefined,
    )
    if (hasUsefulMetrics) return "Success"

    return "Unset"
}
