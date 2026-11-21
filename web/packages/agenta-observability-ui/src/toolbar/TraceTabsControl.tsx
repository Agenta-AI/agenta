import {useCallback} from "react"

import {useT} from "@agenta/i18n"
import toolbarCatalog from "@agenta/i18n/catalogs/observabilityUi.toolbar"
import {filtersAtom, traceTabsAtom, type TraceTabTypes} from "@agenta/observability"
import {getHostQueryClient} from "@agenta/shared/api"
import {Segmented, type SegmentedProps, type SegmentedValue} from "@agenta/ui/ui"
import {useAtom, useAtomValue} from "jotai"

import {useDropFilterField, useUpdateFilter} from "./filterControls"

/**
 * Root / LLM / All. "LLM" is not a projection of its own — it is the `span` projection plus a
 * `span_type=chat` filter, so the control owns that coupling in both directions.
 */
export const TraceTabsControl = () => {
    const t = useT(toolbarCatalog)
    const options: SegmentedProps["options"] = [
        {label: t("observabilityUi.toolbar.tabRoot"), value: "trace"},
        {label: t("observabilityUi.toolbar.tabLlm"), value: "chat"},
        {label: t("observabilityUi.toolbar.tabAll"), value: "span"},
    ]
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
            aria-label={t("observabilityUi.toolbar.traceProjection")}
            options={options}
            value={traceTabs}
            onChange={onChange}
        />
    )
}

export default TraceTabsControl
