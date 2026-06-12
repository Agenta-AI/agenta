import {useCallback} from "react"

import type {EvaluationRunKind, EvaluationRunTableRow} from "@agenta/evaluations/state/runsTable"

import {navigateToRun, navigateToVariant, navigateToTestset} from "../actions/navigationActions"

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

    const handleTestsetNavigation = useCallback((testsetId: string, revisionId?: string | null) => {
        navigateToTestset(testsetId, revisionId)
    }, [])

    return {
        handleOpenRun,
        handleVariantNavigation,
        handleTestsetNavigation,
    }
}

export default useEvaluationRunNavigationActions
