import {sortEvaluatorResults} from "@agenta/entities/evaluationRun"

import {EvaluatorResultRow, type EvaluatorResultRowProps} from "./EvaluatorResultRow"

export interface EvaluatorResultListItem extends EvaluatorResultRowProps {
    /** Unique per row: the evaluator's step key. */
    id: string
}

/** One row per evaluator: failed and errored first, by name; then the others; then not run. */
export const EvaluatorResultList = ({items}: {items: readonly EvaluatorResultListItem[]}) => (
    <div className="flex min-w-0 flex-col">
        {sortEvaluatorResults(items).map(({id, ...row}) => (
            <EvaluatorResultRow key={id} {...row} />
        ))}
    </div>
)
