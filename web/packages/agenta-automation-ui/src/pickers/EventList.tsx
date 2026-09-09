import {useMemo} from "react"

import {
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
} from "@agenta/entities/gatewayTrigger"
import {Button, SkeletonBlock} from "@agenta/ui/ui"

import {EventListEmpty, EventSearchEmpty} from "../states/EventPickerStates"

import {eventLabel, type ConnectedApp} from "./connectedApps"
import {EventRow} from "./EventRow"

/** The chosen app's events — the right pane of the browse view. */
export const EventList = ({
    app,
    selectedEventKey,
    query,
    onClearSearch,
    onPick,
}: {
    app: ConnectedApp
    selectedEventKey: string
    /** What the field holds. Applied here as typed, so the rows never lag behind it. */
    query?: string
    onClearSearch?: () => void
    onPick: (connectionId: string, eventKey: string) => void
}) => {
    const {
        events: fetched,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        requestMore,
    } = useTriggerCatalogEvents(app.integrationKey)

    // The query goes to the server AND the same words are applied here. The catalog's own search
    // is fuzzy and its narrowed pages do not always reach this list, which showed a full catalog
    // under a typed query; matching locally means the rows on screen always answer what was
    // typed. It costs nothing: this is one app's events, already in memory.
    const term = (query ?? "").trim().toLowerCase()
    const events = useMemo(() => {
        if (!term) return fetched
        return fetched.filter((event) =>
            `${event.name ?? ""} ${event.key}`.toLowerCase().includes(term),
        )
    }, [fetched, term])
    // Every event in this list belongs to the same app, so they all wear its mark. Falling back
    // to a letter of the event's own name gave a column of unrelated initials.
    const {integrations, isLoading: catalogLoading} = useTriggerCatalogIntegrations()
    const appLogo = useMemo(
        () => integrations.find((integration) => integration.key === app.integrationKey)?.logo,
        [app.integrationKey, integrations],
    )

    return (
        <div className="flex min-w-0 flex-1 flex-col gap-px">
            {isLoading ? (
                <>
                    <SkeletonBlock active className="h-7 w-full" />
                    <SkeletonBlock active className="h-7 w-4/5" />
                    <SkeletonBlock active className="h-7 w-3/5" />
                </>
            ) : events.length === 0 ? (
                // An app with nothing to watch and a search that matched nothing are different
                // facts: one is about the app, the other is about what was typed. And a search
                // that has matched nothing YET is a third — the catalog is paged, so more of it
                // may still be coming.
                term ? (
                    <EventSearchEmpty
                        query={query ?? ""}
                        appLabel={app.label}
                        hasMore={hasNextPage}
                        loadingMore={isFetchingNextPage}
                        onLoadMore={requestMore}
                        onClear={() => onClearSearch?.()}
                    />
                ) : (
                    <EventListEmpty appLabel={app.label} />
                )
            ) : (
                <>
                    {events.map((event) => (
                        <EventRow
                            key={event.key}
                            label={eventLabel(event.name, event.key)}
                            logo={event.logo || appLogo}
                            logoLoading={catalogLoading}
                            selected={event.key === selectedEventKey}
                            onSelect={() => onPick(app.connectionId, event.key)}
                        />
                    ))}
                    {hasNextPage ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="justify-start text-xs font-normal"
                            disabled={isFetchingNextPage}
                            onClick={requestMore}
                        >
                            {isFetchingNextPage ? "Loading…" : "Show more events"}
                        </Button>
                    ) : null}
                </>
            )}
        </div>
    )
}
