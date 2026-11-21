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
    if (missing.length === 0) return null
    const list = missing.join(", ")
    return (
        <Alert
            type="warning"
            showIcon
            message={`${testset.name} has no ${missing.length === 1 ? "column" : "columns"} for ${list}`}
            description="Every row will fail with missing inputs. Pick another test set, or add the column to this one."
        />
    )
}
