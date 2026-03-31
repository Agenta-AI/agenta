import {useMemo, useRef} from "react"

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

    // Cache the last valid selection to prevent flickering when scrolling
    const cachedSelectionRef = useRef<ScenarioColumnValueSelection | null>(null)

    // Always use enabled: true for the atom key to maintain cache identity
    // Visibility-based loading is handled at the component level, not atom level
    const columnConfig = useMemo(() => buildColumnValueConfig(column, {enabled: true}), [column])
    const selectionAtom = useMemo(
        () => scenarioColumnValueSelectionAtomFamily({scenarioId, runId, column: columnConfig}),
        [scenarioId, runId, columnConfig],
    )

    const selection = useAtomValueWithSchedule(selectionAtom, {priority: LOW_PRIORITY})

    // Update cache when we have a valid value
    if (selection.value !== undefined && selection.value !== null) {
        cachedSelectionRef.current = selection
    }

    // Use cached value if available and current selection has no value
    const effectiveSelection =
        selection.value !== undefined && selection.value !== null
            ? selection
            : (cachedSelectionRef.current ?? selection)

    // Show skeleton only during initial load when we have no data yet
    const hasValue = effectiveSelection.value !== undefined && effectiveSelection.value !== null
    const showSkeleton = !hasValue && selection.isLoading

    return {
        ref: disableVisibilityTracking ? undefined : ref,
        selection: effectiveSelection,
        isVisible: disableVisibilityTracking ? true : isVisible,
        showSkeleton,
    }
}

export type {ScenarioColumnValueSelection}
export default useScenarioCellValue
