import {useMemo} from "react"

import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    buildColumnValueConfig,
    scenarioColumnValueSelectionAtomFamily,
    type ScenarioColumnValueSelection,
} from "../atoms/scenarioColumnValues"
import type {EvaluationTableColumn} from "../atoms/table"

import {useCellVisibility} from "./useCellVisibility"

interface UseScenarioCellValueArgs {
    scenarioId?: string
    runId?: string
    column: EvaluationTableColumn
    disableVisibilityTracking?: boolean
}

/**
 * Hook for fetching scenario cell values with visibility-based lazy loading.
 * Uses atoms directly for data fetching.
 */
const useScenarioCellValue = ({
    scenarioId,
    runId,
    column,
    disableVisibilityTracking = false,
}: UseScenarioCellValueArgs) => {
    const {ref, isVisible} = useCellVisibility()
    const enabled = disableVisibilityTracking ? true : isVisible

    const columnConfig = useMemo(() => buildColumnValueConfig(column, {enabled}), [column, enabled])
    const selectionAtom = useMemo(
        () => scenarioColumnValueSelectionAtomFamily({scenarioId, runId, column: columnConfig}),
        [scenarioId, runId, columnConfig],
    )

    const selection = useAtomValueWithSchedule(selectionAtom, {priority: LOW_PRIORITY})

    const showSkeleton = disableVisibilityTracking
        ? selection.isLoading
        : !isVisible || selection.isLoading

    return {
        ref: disableVisibilityTracking ? undefined : ref,
        selection,
        isVisible: disableVisibilityTracking ? true : isVisible,
        showSkeleton,
    }
}

export type {ScenarioColumnValueSelection}
export default useScenarioCellValue
