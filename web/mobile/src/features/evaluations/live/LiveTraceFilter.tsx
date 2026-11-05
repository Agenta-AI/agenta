import {useMemo} from "react"

import {LIVE_INVOCATION_FILTER} from "@agenta/entities/evaluationRun"
import {getFilterColumns, type Filter} from "@agenta/observability"
import {FilterDialog} from "@agenta/observability-ui"

/**
 * The trace filter of a live evaluation: the shared filter dialog with the invocation row
 * locked at the top. It shows and returns only the user's rows. It has no Annotation fields:
 * the traces page applies them in a second query, and the stored live query cannot, so the API
 * would drop the condition and evaluate every trace.
 */
export const LiveTraceFilter = ({
    userFilters,
    disabled,
    onChange,
}: {
    userFilters: Filter[]
    disabled?: boolean
    onChange: (userFilters: Filter[]) => void
}) => {
    const columns = useMemo(
        () =>
            getFilterColumns().filter(
                (node) => !(node.kind === "group" && node.label === "Annotation"),
            ),
        [],
    )
    const filterData = useMemo(() => [LIVE_INVOCATION_FILTER, ...userFilters], [userFilters])
    const apply = (rows: Filter[]) => onChange(rows.filter((row) => !row.isPermanent))

    return (
        <FilterDialog
            filterData={filterData}
            columns={columns}
            onApplyFilter={apply}
            onClearFilter={apply}
            // The trigger sits inside the live evaluation form: as a submit button it would create.
            buttonProps={{disabled, htmlType: "button"}}
        />
    )
}
