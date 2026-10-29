import {useMemo} from "react"

import {
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
} from "@agenta/entities/gatewayTrigger"
import {Button, Input, SkeletonBlock} from "@agenta/ui/ui"
import {Search} from "lucide-react"

import {EventListEmpty, EventSearchEmpty} from "../states/EventPickerStates"

import {eventLabel, type ConnectedApp} from "./connectedApps"
import {EventRow} from "./EventRow"

/** The chosen app's events — the right pane of the browse view. */
export const EventList = ({
    app,
    selectedEventKey,
    search,
    onSearchChange,
    onPick,
}: {
    app: ConnectedApp
    selectedEventKey: string
    /** What the field holds. Applied here as typed, so the rows never lag behind it. */
    search: string
    onSearchChange: (next: string) => void
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
    const term = search.trim().toLowerCase()
    const events = useMemo(() => {
        if (!term) return fetched
        return fetched.filter((event) =>
            `${event.name ?? ""} ${event.key}`.toLowerCase().includes(term),
        )
    }, [fetched, term])
    // The app's mark for the empty state, which names the app the rows no longer repeat.
    const {integrations, isLoading: catalogLoading} = useTriggerCatalogIntegrations()
    const appLogo = useMemo(
        () => integrations.find((integration) => integration.key === app.integrationKey)?.logo,
        [app.integrationKey, integrations],
    )

    // The field lives here, over the list it narrows, because this is where the list is known:
    // an app with nothing to watch gets no search box, since there is nothing to search. It
    // stays while a query is typed, or the box would vanish under the words that emptied it.
    const searchable = fetched.length > 0 || term.length > 0

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {searchable ? (
                <div className="relative shrink-0">
                    <Search
                        aria-hidden
                        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        value={search}
                        onChange={(changed) => onSearchChange(changed.target.value)}
                        aria-label={`Search ${app.label} events`}
                        placeholder={`Search ${app.label} events`}
                        className="h-8 pl-8 text-[13px]"
                    />
                </div>
            ) : null}
            {/* The rows scroll under a pinned search field. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden lg:gap-px">
                {isLoading ? (
                    <div className="flex flex-col gap-1.5">
                        {Array.from({length: 6}, (_, index) => (
                            <SkeletonBlock key={index} active className="h-7 w-full" />
                        ))}
                    </div>
                ) : events.length === 0 ? (
                    // An app with nothing to watch and a search that matched nothing are different
                    // facts: one is about the app, the other is about what was typed. And a search
                    // that has matched nothing YET is a third — the catalog is paged, so more of it
                    // may still be coming.
                    term ? (
                        <EventSearchEmpty
                            query={search}
                            appLabel={app.label}
                            hasMore={hasNextPage}
                            loadingMore={isFetchingNextPage}
                            onLoadMore={requestMore}
                            onClear={() => onSearchChange("")}
                        />
                    ) : (
                        <EventListEmpty
                            appLabel={app.label}
                            logo={appLogo}
                            logoLoading={catalogLoading}
                        />
                    )
                ) : (
                    <>
                        {events.map((event) => (
                            <EventRow
                                key={event.key}
                                label={eventLabel(event.name, event.key)}
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
        </div>
    )
}
