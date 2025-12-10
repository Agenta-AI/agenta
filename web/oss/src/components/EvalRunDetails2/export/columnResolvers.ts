/**
 * Column value resolvers for scenario table CSV export
 */

import {useStore} from "jotai"

import {format3Sig} from "@/oss/components/Evaluations/MetricDetailsPopover"

import {
    buildColumnValueConfig,
    scenarioColumnValueSelectionAtomFamily,
} from "../atoms/scenarioColumnValues"
import type {EvaluationTableColumn} from "../atoms/table"
import type {PreviewTableRow} from "../atoms/tableRows"
import {formatMetricDisplay} from "../utils/metricFormatter"

import {formatExportValue, logExportAction} from "./helpers"
import type {ScenarioColumnExportMetadata} from "./types"

/**
 * Resolve meta column values (status, timestamp, etc.) from the row itself
 */
const resolveMetaValue = (
    row: PreviewTableRow,
    column: EvaluationTableColumn | undefined,
): unknown => {
    if (!column || !column.id) {
        return undefined
    }

    const columnId = column.id.toLowerCase()

    // Status column
    if (columnId.includes("status") || column.metaRole === "scenarioIndexStatus") {
        return row.status
    }

    // Timestamp column (for online evaluations)
    if (columnId.includes("timestamp") || column.metaRole === "timestamp") {
        return row.timestamp ?? ""
    }

    // Scenario index
    if (columnId.includes("index") || columnId.includes("scenario")) {
        return row.scenarioIndex
    }

    // Created/updated timestamps
    if (columnId.includes("createdat")) {
        return row.createdAt
    }
    if (columnId.includes("updatedat")) {
        return row.updatedAt
    }

    // Default: try to access the property from the row
    const valueKey = column.valueKey ?? column.path?.split(".").pop()
    if (valueKey && valueKey in row) {
        return (row as any)[valueKey]
    }

    return undefined
}

/**
 * Resolve input column value using the same atom system as the table cells
 */
const resolveInputValue = async (
    store: ReturnType<typeof useStore>,
    row: PreviewTableRow,
    column: EvaluationTableColumn | undefined,
): Promise<unknown> => {
    if (!column) return undefined

    const scenarioId = row.scenarioId ?? row.id
    const runId = row.runId
    if (!scenarioId) {
        logExportAction("Input value: no scenarioId", {row})
        return undefined
    }

    try {
        // Use the same atom system as the table cells
        const columnConfig = buildColumnValueConfig(column, {enabled: true})
        const selectionAtom = scenarioColumnValueSelectionAtomFamily({
            scenarioId,
            runId,
            column: columnConfig,
        })

        // Get initial state - this triggers the atom to start loading if needed
        let selection = store.get(selectionAtom)

        // If data is loading, use Jotai's subscription API to wait for completion
        if (selection.isLoading) {
            selection = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    unsubscribe()
                    resolve(store.get(selectionAtom)) // Return whatever we have after timeout
                }, 10000) // 10 second timeout

                const unsubscribe = store.sub(selectionAtom, () => {
                    const currentSelection = store.get(selectionAtom)
                    if (!currentSelection.isLoading) {
                        clearTimeout(timeout)
                        unsubscribe()
                        resolve(currentSelection)
                    }
                })

                // Check immediately in case it finished loading between get and sub
                const immediateCheck = store.get(selectionAtom)
                if (!immediateCheck.isLoading) {
                    clearTimeout(timeout)
                    unsubscribe()
                    resolve(immediateCheck)
                }
            })
        }

        if (selection.isLoading) {
            logExportAction("Input value: timeout - still loading", {
                scenarioId,
                columnId: column.id,
            })
            return undefined
        }

        return selection.value
    } catch (error) {
        logExportAction("Error resolving input value", {
            scenarioId,
            runId,
            columnId: column?.id,
            error: String(error),
        })
        return undefined
    }
}

/**
 * Resolve invocation column value using the same atom system as the table cells
 */
const resolveInvocationValue = async (
    store: ReturnType<typeof useStore>,
    row: PreviewTableRow,
    column: EvaluationTableColumn | undefined,
): Promise<unknown> => {
    if (!column) return undefined

    const scenarioId = row.scenarioId ?? row.id
    const runId = row.runId
    if (!scenarioId) {
        logExportAction("Invocation value: no scenarioId", {row})
        return undefined
    }

    try {
        // Use the same atom system as the table cells
        const columnConfig = buildColumnValueConfig(column, {enabled: true})
        const selectionAtom = scenarioColumnValueSelectionAtomFamily({
            scenarioId,
            runId,
            column: columnConfig,
        })

        // Get initial state - this triggers the atom to start loading if needed
        let selection = store.get(selectionAtom)

        // If data is loading, use Jotai's subscription API to wait for completion
        if (selection.isLoading) {
            selection = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    unsubscribe()
                    resolve(store.get(selectionAtom))
                }, 10000) // 10 second timeout

                const unsubscribe = store.sub(selectionAtom, () => {
                    const currentSelection = store.get(selectionAtom)
                    if (!currentSelection.isLoading) {
                        clearTimeout(timeout)
                        unsubscribe()
                        resolve(currentSelection)
                    }
                })

                // Check immediately in case it finished loading between get and sub
                const immediateCheck = store.get(selectionAtom)
                if (!immediateCheck.isLoading) {
                    clearTimeout(timeout)
                    unsubscribe()
                    resolve(immediateCheck)
                }
            })
        }

        if (selection.isLoading) {
            logExportAction("Invocation value: timeout - still loading", {
                scenarioId,
                columnId: column.id,
            })
            return undefined
        }

        return selection.value
    } catch (error) {
        logExportAction("Error resolving invocation value", {
            scenarioId,
            runId,
            columnId: column?.id,
            error: String(error),
        })
        return undefined
    }
}

/**
 * Resolve metric column value using the same atom system as the table cells
 */
const resolveMetricValue = async (
    store: ReturnType<typeof useStore>,
    row: PreviewTableRow,
    column: EvaluationTableColumn | undefined,
): Promise<unknown> => {
    if (!column) return undefined

    const scenarioId = row.scenarioId ?? row.id
    const runId = row.runId
    if (!scenarioId) return undefined

    try {
        const columnConfig = buildColumnValueConfig(column, {enabled: true})
        const selectionAtom = scenarioColumnValueSelectionAtomFamily({
            scenarioId,
            runId,
            column: columnConfig,
        })

        // Get initial state - this triggers the atom to start loading if needed
        let selection = store.get(selectionAtom)

        // If data is loading, use Jotai's subscription API to wait for completion
        if (selection.isLoading) {
            selection = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    unsubscribe()
                    resolve(store.get(selectionAtom))
                }, 10000) // 10 second timeout

                const unsubscribe = store.sub(selectionAtom, () => {
                    const currentSelection = store.get(selectionAtom)
                    if (!currentSelection.isLoading) {
                        clearTimeout(timeout)
                        unsubscribe()
                        resolve(currentSelection)
                    }
                })

                // Check immediately in case it finished loading between get and sub
                const immediateCheck = store.get(selectionAtom)
                if (!immediateCheck.isLoading) {
                    clearTimeout(timeout)
                    unsubscribe()
                    resolve(immediateCheck)
                }
            })
        }

        if (selection.isLoading) {
            logExportAction("Metric value: timeout - still loading", {
                scenarioId,
                columnId: column.id,
            })
            return undefined
        }

        const {value} = selection

        // Format metric values with appropriate units for CSV export
        if (typeof value === "number" && column.metricKey) {
            const metricKey = column.metricKey

            // Duration metrics: use appropriate units (s, ms, μs)
            if (
                metricKey === "latency" ||
                metricKey === "duration" ||
                metricKey === "duration.total" ||
                metricKey.includes("duration.cumulative")
            ) {
                const seconds = value * 0.001 // Convert from ms to seconds

                if (seconds >= 1) {
                    // Use seconds for values >= 1s
                    return `${format3Sig(seconds)}s`
                } else if (seconds >= 0.001) {
                    // Use milliseconds for values >= 1ms
                    return `${format3Sig(seconds * 1000)}ms`
                } else {
                    // Use microseconds for very small values
                    return `${format3Sig(seconds * 1000000)}μs`
                }
            }

            // Cost metrics: use format3Sig with $ prefix
            if (
                metricKey === "cost" ||
                metricKey === "costs" ||
                metricKey === "price" ||
                metricKey === "totalCost" ||
                metricKey.includes("costs.cumulative")
            ) {
                return `$${format3Sig(value)}`
            }
        }

        // For other metrics, use standard formatter
        if (column.metricType) {
            const formatted = formatMetricDisplay({
                value,
                metricKey: column.metricKey ?? column.valueKey ?? column.path,
                metricType: column.metricType,
            })
            return formatted === "—" ? "" : formatted
        }

        return value
    } catch (error) {
        logExportAction("Error resolving metric value", {
            scenarioId,
            runId,
            columnId: column?.id,
            error: String(error),
        })
        return undefined
    }
}

/**
 * Main resolver for scenario column values during export
 */
export const resolveScenarioColumnValue = async (
    store: ReturnType<typeof useStore>,
    row: PreviewTableRow,
    column: any,
    metadata: ScenarioColumnExportMetadata,
): Promise<string> => {
    if (!row || row.__isSkeleton) {
        return ""
    }

    let rawValue: unknown

    switch (metadata.type) {
        case "meta":
            rawValue = resolveMetaValue(row, column)
            break
        case "input":
            rawValue = await resolveInputValue(store, row, column)
            break
        case "invocation":
            rawValue = await resolveInvocationValue(store, row, column)
            break
        case "metric":
            rawValue = await resolveMetricValue(store, row, column)
            break
        default:
            rawValue = undefined
    }

    return formatExportValue(rawValue)
}
