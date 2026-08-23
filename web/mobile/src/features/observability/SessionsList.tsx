import {useSessions} from "@agenta/observability"
import {
    EndTimeCell,
    FirstInputCell,
    LastOutputCell,
    ObservabilityList,
    SessionDurationCell,
    SessionIdCell,
    TotalCostCell,
    TracesCountCell,
} from "@agenta/observability-ui"

import {
    ObservabilityEmpty,
    ObservabilityFiltered,
    ObservabilityListSkeleton,
} from "./states/ObservabilityStates"

/**
 * The sessions tab.
 *
 * An observability session has no shared row component, because it has no non-table rendering
 * anywhere to extract. The plan's default applies: mobile stacks the packaged cells in a
 * layout it owns, so the cells stay the single source of formatting and no new shared
 * abstraction gets invented for one caller.
 *
 * Note this is NOT the agent-session entity from `@agenta/sessions`. This is spans grouped by
 * session id, so `SessionCardList` cannot render it.
 */
const SessionRow = ({sessionId}: {sessionId: string}) => (
    <div className="flex flex-col gap-1.5 border-0 border-b border-solid border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
            <SessionIdCell sessionId={sessionId} />
            <span className="text-xs text-muted-foreground">
                <TracesCountCell sessionId={sessionId} />
            </span>
        </div>

        <div className="min-w-0 text-xs text-foreground">
            <FirstInputCell sessionId={sessionId} />
        </div>
        <div className="min-w-0 text-xs text-muted-foreground">
            <LastOutputCell sessionId={sessionId} />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <EndTimeCell sessionId={sessionId} />
            <SessionDurationCell sessionId={sessionId} />
            <TotalCostCell sessionId={sessionId} />
        </div>
    </div>
)

export const SessionsList = () => {
    const {
        sessionIds,
        isLoading,
        isFetchingMore,
        hasMoreSessions,
        fetchMoreSessions,
        filters,
        setFilters,
    } = useSessions()

    return (
        <ObservabilityList
            items={sessionIds}
            keyOf={(sessionId) => sessionId}
            renderItem={(sessionId) => <SessionRow sessionId={sessionId} />}
            isLoading={isLoading}
            isLoadingMore={isFetchingMore}
            hasMore={hasMoreSessions}
            loadMore={fetchMoreSessions}
            empty={
                isLoading ? (
                    <ObservabilityListSkeleton />
                ) : filters.length > 0 ? (
                    <ObservabilityFiltered onClear={() => setFilters([])} />
                ) : (
                    <ObservabilityEmpty
                        title="No sessions yet"
                        hint="Sessions appear here once your app groups traces by session id."
                    />
                )
            }
        />
    )
}

export default SessionsList
