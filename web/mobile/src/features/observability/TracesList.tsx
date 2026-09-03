import {useObservability} from "@agenta/observability"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {ObservabilityList, TraceRow} from "@agenta/observability-ui"
import {useSetAtom} from "jotai"

import {
    ObservabilityEmpty,
    ObservabilityError,
    ObservabilityFiltered,
    ObservabilityListSkeleton,
} from "./states/ObservabilityStates"

/**
 * The traces tab: the packaged list shell over the packaged trace row.
 *
 * There is no mobile-only rendering here on purpose. Both come from
 * `@agenta/observability-ui`, so a change to how a span reads lands on desktop and here at
 * the same time.
 */
export const TracesList = () => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const {
        traces,
        isLoading,
        isFetchingMore,
        hasMoreTraces,
        fetchMoreTraces,
        isRateLimited,
        rateLimitMessage,
        filters,
        setFilters,
        fetchTraces,
    } = useObservability()

    const hasFilters = filters.length > 0

    return (
        <ObservabilityList
            items={traces}
            keyOf={(span, index) => span.span_id ?? String(index)}
            renderItem={(span) => (
                // The phone list had no way into a trace at all; this is the same drawer the
                // table opens, so both widths reach the same detail view.
                <div
                    role="button"
                    tabIndex={0}
                    className="border-0 border-b border-solid border-border px-4 py-3 cursor-pointer"
                    onClick={() =>
                        openTraceDrawer({
                            traceId: span.trace_id || span.span_id || "",
                            activeSpanId: span.span_id ?? null,
                        })
                    }
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            openTraceDrawer({
                                traceId: span.trace_id || span.span_id || "",
                                activeSpanId: span.span_id ?? null,
                            })
                        }
                    }}
                >
                    <TraceRow span={span} />
                </div>
            )}
            isLoading={isLoading}
            isLoadingMore={isFetchingMore}
            hasMore={hasMoreTraces}
            loadMore={fetchMoreTraces}
            error={
                isRateLimited ? (
                    <ObservabilityError
                        message={rateLimitMessage ?? "Too many requests."}
                        onRetry={fetchTraces}
                    />
                ) : undefined
            }
            empty={
                isLoading ? (
                    <ObservabilityListSkeleton />
                ) : hasFilters ? (
                    <ObservabilityFiltered onClear={() => setFilters([])} />
                ) : (
                    <ObservabilityEmpty />
                )
            }
        />
    )
}

export default TracesList
