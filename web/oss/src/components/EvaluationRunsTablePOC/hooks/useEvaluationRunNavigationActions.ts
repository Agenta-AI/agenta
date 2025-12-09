import {useCallback} from "react"

import {navigateToRun, navigateToVariant, navigateToTestset} from "../actions/navigationActions"
import type {EvaluationRunKind, EvaluationRunTableRow} from "../types"

interface UseEvaluationRunNavigationActionsParams {
    scope: "app" | "project"
    evaluationKind: EvaluationRunKind
}

const useEvaluationRunNavigationActions = ({
    scope,
    evaluationKind,
}: UseEvaluationRunNavigationActionsParams) => {
    const handleOpenRun = useCallback(
        (record: EvaluationRunTableRow) => {
            navigateToRun({record, scope, evaluationKind})
        },
        [evaluationKind, scope],
    )

    const handleVariantNavigation = useCallback(
        (params: {revisionId: string; appId?: string | null}) => {
            navigateToVariant(params)
        },
        [],
    )

    const handleTestsetNavigation = useCallback((testsetId: string) => {
        navigateToTestset(testsetId)
    }, [])

    return {
        handleOpenRun,
        handleVariantNavigation,
        handleTestsetNavigation,
    }
}

export default useEvaluationRunNavigationActions
