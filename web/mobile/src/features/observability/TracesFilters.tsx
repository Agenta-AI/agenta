import {useMemo} from "react"

import {
    buildAttributeKeyTreeOptions,
    getFilterColumns,
    useObservability,
} from "@agenta/observability"
import {FilterDialog} from "@agenta/observability-ui"

/**
 * The traces filter control, on the shared dialog and column builder.
 */
export const TracesFilters = () => {
    const {filters, setFilters, traces} = useObservability()

    const columns = useMemo(() => getFilterColumns(buildAttributeKeyTreeOptions(traces)), [traces])

    return (
        <FilterDialog
            filterData={filters}
            columns={columns}
            onApplyFilter={setFilters}
            onClearFilter={setFilters}
        />
    )
}

export default TracesFilters
