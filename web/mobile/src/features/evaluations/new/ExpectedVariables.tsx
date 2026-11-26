import type {DraftRevision} from "./newEvaluationDraft"
import {useExpectedInputVariables} from "./useExpectedInputVariables"

/** The input variables the picked revisions expect, so the user can match a test set to them. */
export const ExpectedVariables = ({revisions}: {revisions: readonly DraftRevision[]}) => {
    const names = useExpectedInputVariables(revisions)
    if (names.length === 0) return null
    return (
        <p className="m-0 text-xs text-muted-foreground">
            Expected input variables for selected variant(s):{" "}
            <span className="font-mono">{names.join(", ")}</span>
        </p>
    )
}
