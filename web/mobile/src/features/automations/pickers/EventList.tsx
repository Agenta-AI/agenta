import {useMemo} from "react"

import {
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
} from "@agenta/entities/gatewayTrigger"

import {Button} from "@/components/ui/button"
import {Skeleton} from "@/components/ui/skeleton"

import {eventLabel, type ConnectedApp} from "./connectedApps"
import {EventRow} from "./EventRow"

/** The chosen app's events — the right pane of the browse view. */
export const EventList = ({
    app,
    selectedEventKey,
    onPick,
}: {
    app: ConnectedApp
    selectedEventKey: string
    onPick: (connectionId: string, eventKey: string) => void
}) => {
    const {events, isLoading, hasNextPage, isFetchingNextPage, requestMore} =
        useTriggerCatalogEvents(app.integrationKey)
    // Every event in this list belongs to the same app, so they all wear its mark. Falling back
    // to a letter of the event's own name gave a column of unrelated initials.
    const {integrations, isLoading: catalogLoading} = useTriggerCatalogIntegrations()
    const appLogo = useMemo(
        () => integrations.find((integration) => integration.key === app.integrationKey)?.logo,
        [app.integrationKey, integrations],
    )

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-px overflow-y-auto">
            {isLoading ? (
                <>
                    <Skeleton className="h-7 w-full" />
                    <Skeleton className="h-7 w-4/5" />
                    <Skeleton className="h-7 w-3/5" />
                </>
            ) : events.length === 0 ? (
                <p className="m-0 px-2 py-3 text-[12px] leading-snug text-muted-foreground">
                    No events for this app.
                </p>
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
                            className="font-normal"
                            disabled={isFetchingNextPage}
                            onClick={requestMore}
                            className="justify-start"
                        >
                            {isFetchingNextPage ? "Loading…" : "Show more events"}
                        </Button>
                    ) : null}
                </>
            )}
        </div>
    )
}
