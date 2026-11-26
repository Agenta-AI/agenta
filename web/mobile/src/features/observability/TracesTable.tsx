import type {Key} from "react"

import {useObservability} from "@agenta/observability"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {EmptyObservability, ObservabilityTracesTable} from "@agenta/observability-ui"
import {RoleColorClassesProvider, THEME_ROLE_COLOR_CLASSES} from "@agenta/ui/cell-renderers"
import {useSetAtom} from "jotai"

import {
    ObservabilityEmpty,
    ObservabilityFiltered,
    ObservabilityListSkeleton,
} from "./states/ObservabilityStates"

// Every cell draws its own row line, as an inset shadow: in a collapsed table a pinned (sticky)
// cell does not paint the row's border, so the checkbox and Name cells showed no line. The row's
// own border goes, or the scrolling cells would show two.
const ROW_LINES =
    "[&_td.avt-cell]:[box-shadow:inset_0_-1px_0_var(--colorBorderSecondary)] [&_tr.avt-row]:border-b-0"

/**
 * The traces table — the shared component, through the shared shell.
 *
 * The shell owns sizing (`autoHeight` fills the flex parent), so nothing is threaded through
 * here; passing a height once made the body a fixed few hundred pixels with dead space below.
 */
export const TracesTable = ({
    selectedRowKeys,
    onSelectionChange,
}: {
    selectedRowKeys: Key[]
    onSelectionChange: (keys: Key[]) => void
}) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const {isRateLimited, rateLimitMessage, filters, setFilters} = useObservability()

    // As in the old app, a rate-limited project gets its own state instead of the table.
    if (isRateLimited) {
        return <EmptyObservability rateLimited rateLimitMessage={rateLimitMessage ?? undefined} />
    }

    return (
        // The role labels in the message cells take the theme colors; /m has no antd color scale.
        <RoleColorClassesProvider value={THEME_ROLE_COLOR_CLASSES}>
            <ObservabilityTracesTable
                className={`min-h-0 flex-1 ${ROW_LINES}`}
                loadingState={<ObservabilityListSkeleton />}
                emptyState={
                    filters.length > 0 ? (
                        <ObservabilityFiltered onClear={() => setFilters([])} />
                    ) : (
                        <ObservabilityEmpty />
                    )
                }
                rowSelection={{
                    type: "checkbox",
                    selectedRowKeys,
                    onChange: (keys) => onSelectionChange(keys),
                }}
                // Tapping a row opens the trace drawer.
                onRowClick={(record) =>
                    openTraceDrawer({
                        traceId: record.trace_id || record.key,
                        activeSpanId: record.span_id ?? null,
                    })
                }
            />
        </RoleColorClassesProvider>
    )
}

export default TracesTable
