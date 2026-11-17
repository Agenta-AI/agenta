import {useMemo} from "react"

import {
    buildAttributeKeyTreeOptions,
    getFilterColumns,
    useObservability,
} from "@agenta/observability"
import {FILTER_COLUMN_ICONS, FilterDialog} from "@agenta/observability-ui"

import {useDeveloperViewEnabled} from "@/features/developer/developerViewAccess"

import {AnnotatedTracesFilter} from "./filters/AnnotatedTracesFilter"
import {TRACE_ACTIONS_VIEW_ID} from "./useTraceActionAccess"

/**
 * The traces filter control, on the shared dialog and column builder. With the trace actions view
 * on, its annotation row gets the evaluator and feedback controls.
 */
export const TracesFilters = () => {
    const {filters, setFilters, traces} = useObservability()
    const annotated = useDeveloperViewEnabled(TRACE_ACTIONS_VIEW_ID) === true
    const Dialog = annotated ? AnnotatedTracesFilter : FilterDialog

    const columns = useMemo(
        () => getFilterColumns(buildAttributeKeyTreeOptions(traces), FILTER_COLUMN_ICONS),
        [traces],
    )

    return (
        <Dialog
            filterData={filters}
            columns={columns}
            onApplyFilter={setFilters}
            onClearFilter={setFilters}
        />
    )
}

export default TracesFilters
