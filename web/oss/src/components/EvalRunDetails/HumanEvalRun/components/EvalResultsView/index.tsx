import {memo} from "react"

import EvalRunOverviewViewer from "../../../components/EvalRunOverviewViewer"

/**
 * Displays run-level evaluation results grouped by evaluator.
 * Uses selectAtom to subscribe only to the evaluator *list shape* (slug array) so the
 * parent component re-renders only when evaluators are added/removed – any metric changes
 * are handled inside each card.
 */
const EvalResultsView = ({runId}: {runId: string}) => {
    return (
        <section className="overflow-y-auto flex flex-col gap-4" id="tour-human-eval-results-view">
            <EvalRunOverviewViewer />
        </section>
    )
}

export default memo(EvalResultsView)
