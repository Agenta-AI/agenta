import type {EvaluationTableColumn} from "../atoms/table"

import {useScenarioStepValueSelection} from "./useScenarioStepValue"
import {useCellVisibility} from "./useCellVisibility"

interface UseScenarioCellValueArgs {
    scenarioId?: string
    runId?: string
    column: EvaluationTableColumn
    disableVisibilityTracking?: boolean
}

const useScenarioCellValue = ({
    scenarioId,
    runId,
    column,
    disableVisibilityTracking = false,
}: UseScenarioCellValueArgs) => {
    const {ref, isVisible} = useCellVisibility()
    const enabled = disableVisibilityTracking ? true : isVisible
    const selection = useScenarioStepValueSelection({scenarioId, runId, column}, {enabled: enabled})
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

export default useScenarioCellValue
