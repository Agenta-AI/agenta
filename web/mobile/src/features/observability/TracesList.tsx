import {useObservability} from "@agenta/observability"
import {ObservabilityList, TraceRow} from "@agenta/observability-ui"

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
                <div className="border-0 border-b border-solid border-border px-4 py-3">
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
