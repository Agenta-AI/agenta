import {useMemo, useState} from "react"

import {
    runListColumns,
    type EvaluationRun,
    type RunListColumns,
    type RunListTab,
} from "@agenta/entities/evaluationRun"

/** The columns of a runs table outside the list (the app overview): no metric columns. */
const BASIC_COLUMNS: RunListColumns = {
    showKind: true,
    references: ["application", "testset"],
    evaluators: [],
    invocation: [],
}

/**
 * The columns of the runs list for the tab and the runs on screen, as the old list picks them;
 * without a tab, the basic columns.
 * The list refreshes every five seconds while a run is in progress. The same plan object comes
 * back until a column changes, so the header and the cells do not redraw on every refresh.
 */
export const useRunListColumns = (
    runs: readonly EvaluationRun[],
    tab: RunListTab | null,
): RunListColumns => {
    const next = useMemo(() => (tab ? runListColumns(runs, tab) : BASIC_COLUMNS), [runs, tab])
    const nextKey = useMemo(() => JSON.stringify(next), [next])
    const [current, setCurrent] = useState({key: nextKey, plan: next})
    if (current.key !== nextKey) {
        setCurrent({key: nextKey, plan: next})
        return next
    }
    return current.plan
}
