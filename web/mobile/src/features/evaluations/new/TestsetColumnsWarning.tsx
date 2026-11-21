import {useT} from "@agenta/i18n"
import evaluationScreensCatalog from "@agenta/i18n/catalogs/evaluations.screens"
import {Alert} from "@agenta/ui/ui"

import type {DraftTestset} from "./newEvaluationDraft"

/** Warns when the picked test set has no column for an input the picked revisions expect. */
export const TestsetColumnsWarning = ({
    testset,
    missing,
}: {
    testset: DraftTestset
    /** From `useMissingInputColumns`. */
    missing: readonly string[]
}) => {
    const t = useT(evaluationScreensCatalog)
    if (missing.length === 0) return null
    const list = missing.join(", ")
    return (
        <Alert
            type="warning"
            showIcon
            message={`${testset.name} has no ${missing.length === 1 ? "column" : "columns"} for ${list}`}
            description={t("evaluations.screens.missingInputsHint")}
        />
    )
}
