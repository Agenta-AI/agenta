import {useEffect, useMemo, useRef} from "react"

import {useQueryClient} from "@tanstack/react-query"

import {clearPreviewRunsCache} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunsRequest"
import {EvaluationStatus} from "@/oss/lib/Types"

import type {EvaluationRunTableRow} from "../types"

import {clearMetricSelectionCache} from "./useRunMetricSelection"

/** Statuses that indicate an evaluation is still in progress */
const IN_PROGRESS_STATUSES = new Set<string>([
    EvaluationStatus.INITIALIZED,
    EvaluationStatus.STARTED,
    EvaluationStatus.RUNNING,
    EvaluationStatus.PENDING,
])

/** Polling interval in milliseconds when evaluations are running */
const POLLING_INTERVAL_MS = 5_000

/**
 * Checks if a row's status indicates the evaluation is still in progress.
 */
const isRowInProgress = (row: EvaluationRunTableRow): boolean => {
    if (row.__isSkeleton) return false
    const status = row.status
    if (!status) return false
    return IN_PROGRESS_STATUSES.has(status)
}

interface UseEvaluationRunsPollingOptions {
    /** The rows currently displayed in the table */
    rows: EvaluationRunTableRow[]
    /** Whether the table is active and should poll */
    enabled?: boolean
}

/**
 * Hook that polls for evaluation run updates when there are running evaluations.
 *
 * This hook monitors the displayed rows for in-progress statuses (INITIALIZED, STARTED,
 * RUNNING, PENDING) and automatically refreshes the table data at regular intervals
 * while evaluations are running. Polling stops when all evaluations are complete.
 *
 * Uses background refetch to update data in place without showing loading skeletons.
 */
const useEvaluationRunsPolling = ({rows, enabled = true}: UseEvaluationRunsPollingOptions) => {
    const queryClient = useQueryClient()
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const hasRunningEvaluations = useMemo(() => {
        if (!enabled) return false
        return rows.some(isRowInProgress)
    }, [rows, enabled])

    useEffect(() => {
        // Clear any existing interval
        if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
        }

        if (!hasRunningEvaluations) {
            return
        }

        // Start polling
        intervalRef.current = setInterval(async () => {
            // Clear caches to ensure fresh data
            clearPreviewRunsCache()
            clearMetricSelectionCache()

            // Use refetchQueries instead of invalidateQueries to do a background
            // refetch that updates data in place without showing loading skeletons
            await queryClient.refetchQueries({
                predicate: (query) => {
                    const key = query.queryKey
                    if (!Array.isArray(key)) return false
                    // Match evaluation-runs-table queries
                    if (key[0] === "evaluation-runs-table") return true
                    // Match run metric stats queries
                    if (key[0] === "preview" && key[1] === "run-metric-stats") return true
                    return false
                },
            })
        }, POLLING_INTERVAL_MS)

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }
    }, [hasRunningEvaluations, queryClient])

    return {
        isPolling: hasRunningEvaluations,
    }
}

export default useEvaluationRunsPolling
