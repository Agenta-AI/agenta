import {useAtomValue} from "jotai"

import {missingInputColumns} from "./missingInputColumns"
import type {DraftRevision, DraftTestset} from "./newEvaluationDraft"
import {testsetColumnKeysAtomFamily} from "./testsetColumnKeys"
import {useExpectedInputVariables} from "./useExpectedInputVariables"

/** The inputs the picked revisions expect that the picked test set has no column for. */
export const useMissingInputColumns = (
    projectId: string,
    revisions: readonly DraftRevision[],
    testset: DraftTestset | null,
): string[] => {
    const expected = useExpectedInputVariables(revisions)
    const columns = useAtomValue(
        testsetColumnKeysAtomFamily(`${projectId}|${testset?.revisionId ?? ""}`),
    )
    if (!testset || expected.length === 0 || !columns.data?.hasRows) return []
    return missingInputColumns(expected, columns.data.keys)
}
