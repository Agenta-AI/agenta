import {useCallback} from "react"

import {filtersAtom, traceTabsAtom, type TraceTabTypes} from "@agenta/observability"
import {getHostQueryClient} from "@agenta/shared/api"
import {Segmented, type SegmentedProps, type SegmentedValue} from "@agenta/ui/ui"
import {useAtom, useAtomValue} from "jotai"

import {useDropFilterField, useUpdateFilter} from "./filterControls"

const TRACE_TAB_OPTIONS: SegmentedProps["options"] = [
    {label: "Root", value: "trace"},
    {label: "LLM", value: "chat"},
    {label: "All", value: "span"},
]

/**
 * Root / LLM / All. "LLM" is not a projection of its own — it is the `span` projection plus a
 * `span_type=chat` filter, so the control owns that coupling in both directions.
 */
export const TraceTabsControl = () => {
    const [traceTabs, setTraceTabs] = useAtom(traceTabsAtom)
    const filters = useAtomValue(filtersAtom)
    const dropFilterField = useDropFilterField()
    const updateFilter = useUpdateFilter()

    const onChange = useCallback(
        (value: SegmentedValue) => {
            const selectedTab = String(value) as TraceTabTypes
            // The rows change shape with the projection, so the cached pages no longer apply.
            getHostQueryClient().removeQueries({queryKey: ["tracing"]})
            setTraceTabs(selectedTab)

            if (selectedTab === "chat") {
                updateFilter({field: "span_type", operator: "is", value: selectedTab})
                return
            }

            const isSpanTypeFilterExist = filters.some(
                (item) => item.field === "span_type" && item.value === "chat",
            )
            if (isSpanTypeFilterExist) dropFilterField("span_type")
        },
        [filters, updateFilter, dropFilterField, setTraceTabs],
    )

    return (
        <Segmented
            aria-label="Trace projection"
            options={TRACE_TAB_OPTIONS}
            value={traceTabs}
            onChange={onChange}
        />
    )
}

export default TraceTabsControl
