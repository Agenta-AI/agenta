import {useMemo} from "react"

import {
    buildAttributeKeyTreeOptions,
    getFilterColumns,
    useObservability,
} from "@agenta/observability"
import {FilterDialog} from "@agenta/observability-ui"

/**
 * The filter control the desktop toolbar carries. The dialog and the column builder are both
 * shared already; web/oss only reaches for its own wrapper to bind app-layer icons and the
 * annotation row, neither of which `/m` needs to show the same filters.
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
