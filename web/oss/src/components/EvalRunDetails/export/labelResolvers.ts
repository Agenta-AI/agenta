/**
 * Column label resolvers for scenario table CSV export
 */

import {humanizeMetricPath} from "@/oss/lib/evaluations/utils/metrics"

import type {EvaluationTableColumn} from "../atoms/table"
import {humanizeStepKey, resolveGroupLabel} from "../utils/labelHelpers"

import type {ScenarioColumnExportMetadata} from "./types"

const OUTPUT_METRIC_PATH_PREFIX = /^attributes\.ag\.data\.outputs\.?/i

/**
 * Strip the attributes.ag.data.outputs prefix from metric paths for cleaner labels
 */
function stripOutputsNamespace(value?: string | null): string | null {
    if (!value) return null
    const stripped = value.replace(OUTPUT_METRIC_PATH_PREFIX, "")
    return stripped.length ? stripped : "output"
}

/**
 * Normalize and humanize a metric path for display
 */
function normalizeMetricLabel(metricKey?: string | null): string | undefined {
    if (!metricKey) return undefined
    const normalized = stripOutputsNamespace(metricKey) ?? metricKey
    if (!normalized) return undefined
    return humanizeMetricPath(normalized) || normalized
}

/**
 * Clean up technical IDs from labels (e.g., "Testset 019ada…3d9b" -> "Testset")
 */
function cleanTechnicalIds(label: string): string {
    if (!label) return label

    // Remove patterns like "019ada…3d9b" or "019b0...3dbb" (ULID-style IDs with ellipsis)
    // Match: space + any alphanumeric + ellipsis (… or ...) + any alphanumeric
    let cleaned = label.replace(/\s+[0-9a-zA-Z]{3,}(…|\.{2,})[0-9a-zA-Z]{3,}/g, "")

    // Remove full ULIDs/UUIDs (with or without hyphens)
    cleaned = cleaned.replace(
        /\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "",
    )

    // Remove long alphanumeric strings (likely IDs)
    cleaned = cleaned.replace(/\s+[0-9a-zA-Z]{20,}/g, "")

    // Clean up multiple spaces
    cleaned = cleaned.replace(/\s+/g, " ").trim()

    return cleaned
}

/**
 * Resolve a human-readable column label for CSV export
 */
export const resolveScenarioColumnLabel = (
    column: any,
    metadata: ScenarioColumnExportMetadata,
    groups?: Map<string, any>,
): string | undefined => {
    const tableColumn = column as EvaluationTableColumn

    // Special handling for meta columns
    if (metadata.type === "meta") {
        // Status column should be labeled "status" instead of "#"
        if (tableColumn.metaRole === "scenarioIndexStatus") {
            return "status"
        }
    }

    // Try to get the display label first
    let label = tableColumn.displayLabel ?? tableColumn.label

    // For input/invocation columns, prepend the group label
    if (metadata.type === "input" || metadata.type === "invocation") {
        if (tableColumn.groupId && groups) {
            const group = groups.get(tableColumn.groupId)
            if (group) {
                const rawGroupLabel =
                    resolveGroupLabel(group) ??
                    group.label ??
                    humanizeStepKey(group.id, group.kind) ??
                    ""

                // Clean up the group label to remove technical IDs
                const groupLabel = cleanTechnicalIds(rawGroupLabel)

                if (groupLabel) {
                    // Clean up the column label as well
                    const cleanLabel = cleanTechnicalIds(label || tableColumn.valueKey || "Value")
                    return `${groupLabel} - ${cleanLabel}`
                }
            }
        }

        // Fallback: just use the label with the step type
        const typePrefix = metadata.type === "input" ? "Input" : "Output"
        const cleanLabel = cleanTechnicalIds(label || tableColumn.valueKey || tableColumn.path)
        return `${typePrefix} - ${cleanLabel}`
    }

    // For metric columns, try to normalize the metric path
    if (metadata.type === "metric") {
        const metricLabel = normalizeMetricLabel(tableColumn.metricKey ?? tableColumn.path)
        if (metricLabel) {
            label = metricLabel
        }

        // If the column has a group, prepend the group label
        if (tableColumn.groupId && groups) {
            const group = groups.get(tableColumn.groupId)
            if (group) {
                const rawGroupLabel =
                    resolveGroupLabel(group) ??
                    group.label ??
                    humanizeStepKey(group.id, group.kind) ??
                    ""

                const groupLabel = cleanTechnicalIds(rawGroupLabel)

                if (groupLabel) {
                    return `${groupLabel} - ${label}`
                }
            }
        }
    }

    // Fallback to humanized label
    const fallbackLabel =
        label || humanizeStepKey(tableColumn.id, tableColumn.kind) || tableColumn.id
    return cleanTechnicalIds(fallbackLabel)
}

/**
 * Build a map of group IDs to group objects for efficient lookup
 */
export const buildGroupMap = (groups?: any[]): Map<string, any> => {
    const map = new Map<string, any>()
    if (!groups) return map

    groups.forEach((group) => {
        if (group?.id) {
            map.set(group.id, group)
        }
    })

    return map
}
