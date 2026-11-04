import {useMemo} from "react"

import {LIVE_INVOCATION_FILTER} from "@agenta/entities/evaluationRun"
import {getFilterColumns, type Filter} from "@agenta/observability"
import {FilterDialog, type AnnotationRowSlot} from "@agenta/observability-ui"
import dynamic from "next/dynamic"

// The same annotation row as `AnnotatedTracesFilter`. Importing that module here would move it
// into a chunk this sheet shares with the traces page, and the traces page would grow.
const AnnotationRowControls = dynamic(
    () =>
        import("@/features/observability/filters/AnnotationRowControls").then(
            (module) => module.AnnotationRowControls,
        ),
    {ssr: false},
)

const annotationRow: AnnotationRowSlot = {
    renderInline: (context) => <AnnotationRowControls part="evaluator" context={context} />,
    renderBelow: (context) => <AnnotationRowControls part="feedback" context={context} />,
    hidesRowDelete: ({value}) => value?.evaluator !== undefined || value?.feedback !== undefined,
}

/**
 * The trace filter of a live evaluation: the traces filter dialog, with its annotation row,
 * and the invocation row locked at the top. It shows and returns only the user's rows.
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
    const columns = useMemo(() => getFilterColumns(), [])
    const filterData = useMemo(() => [LIVE_INVOCATION_FILTER, ...userFilters], [userFilters])
    const apply = (rows: Filter[]) => onChange(rows.filter((row) => !row.isPermanent))

    return (
        <FilterDialog
            filterData={filterData}
            columns={columns}
            annotationRow={annotationRow}
            onApplyFilter={apply}
            onClearFilter={apply}
            // The trigger sits inside the live evaluation form: as a submit button it would create.
            buttonProps={{disabled, htmlType: "button"}}
        />
    )
}
