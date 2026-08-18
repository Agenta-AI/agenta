import React, {useCallback, useMemo, useRef, useState} from "react"

import {
    triggerEventsDrawerAtom,
    triggerEventsSearchAtom,
    useTriggerCatalogEvents,
    useTriggerEvent,
    type TriggerCatalogEvent,
} from "@agenta/entities/gatewayTrigger"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {ScrollSentinel, ScrollToTopButton} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Badge, Divider, EmptyState, InputAffix, Spinner} from "@agenta/ui/ui"
import {ArrowLeft, MagnifyingGlass} from "@phosphor-icons/react"
import {useAtom, useSetAtom} from "jotai"

import SchemaForm from "../../gatewayTool/components/SchemaForm"

// ---------------------------------------------------------------------------
// TriggerEventsDrawer (root) — opened against a connected integration
// ---------------------------------------------------------------------------

export default function TriggerEventsDrawer() {
    const [state, setState] = useAtom(triggerEventsDrawerAtom)
    const [selectedEvent, setSelectedEvent] = useState<TriggerCatalogEvent | null>(null)
    const setEventsSearch = useSetAtom(triggerEventsSearchAtom)

    const open = !!state

    const handleClose = useCallback(() => {
        setState(null)
        setSelectedEvent(null)
        setEventsSearch("")
    }, [setState, setEventsSearch])

    const handleBack = useCallback(() => {
        setSelectedEvent(null)
    }, [])

    return (
        <EnhancedDrawer
            open={open}
            onClose={handleClose}
            title={
                selectedEvent
                    ? "Event"
                    : `Events${state?.integrationName ? ` · ${state.integrationName}` : ""}`
            }
            // antd `size="large"` = 736px; the EnhancedDrawer facade sizes via `width`.
            width={736}
            destroyOnClose
            styles={{
                body: {
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                },
            }}
        >
            {state &&
                (selectedEvent ? (
                    <EventDetailView
                        integrationKey={state.integrationKey}
                        event={selectedEvent}
                        onBack={handleBack}
                    />
                ) : (
                    <EventsView integrationKey={state.integrationKey} onSelect={setSelectedEvent} />
                ))}
        </EnhancedDrawer>
    )
}

// ---------------------------------------------------------------------------
// Events view (sticky header + scrollable content)
// ---------------------------------------------------------------------------

function EventsView({
    integrationKey,
    onSelect,
}: {
    integrationKey: string
    onSelect: (event: TriggerCatalogEvent) => void
}) {
    const setAtom = useSetAtom(triggerEventsSearchAtom)
    const search = useDebouncedAtomSearch(setAtom)
    const scrollRef = useRef<HTMLDivElement>(null)

    const {
        events,
        total,
        prefetchThreshold,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        requestMore,
    } = useTriggerCatalogEvents(integrationKey)

    const sentinelIndex = useMemo(
        () => Math.max(0, events.length - prefetchThreshold),
        [events.length, prefetchThreshold],
    )

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex flex-col gap-3 px-6 pt-4 pb-3 shrink-0">
                <InputAffix
                    placeholder="Search events…"
                    prefix={<MagnifyingGlass size={16} />}
                    value={search.value}
                    onValueChange={(v) => search.onChange(v)}
                    allowClear
                />
                <span className="text-xs text-[var(--ag-colorTextDescription)]">
                    {total} event{total !== 1 ? "s" : ""}
                </span>
            </div>

            <Divider className="m-0" />

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overscroll-contain px-6 py-3 relative"
            >
                {isLoading && events.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                        <Spinner />
                    </div>
                ) : events.length === 0 ? (
                    <EmptyState description="No events found" />
                ) : (
                    <div className="flex flex-col gap-2">
                        {events.map((event, i) => (
                            <React.Fragment key={event.key}>
                                {i === sentinelIndex && (
                                    <ScrollSentinel
                                        onVisible={requestMore}
                                        hasMore={hasNextPage}
                                        isFetching={isFetchingNextPage}
                                    />
                                )}
                                {/* antd Card (size="small" hoverable): colorBorderSecondary
                                    border, borderRadiusLG, 12px body padding; hover swaps the
                                    border for boxShadowCard. */}
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => onSelect(event)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault()
                                            onSelect(event)
                                        }
                                    }}
                                    className="box-border cursor-pointer rounded-control-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)] p-3 transition-shadow hover:border-transparent hover:shadow-[0_1px_2px_-2px_rgba(0,0,0,0.16),0_3px_6px_0_rgba(0,0,0,0.12),0_5px_12px_4px_rgba(0,0,0,0.09)]"
                                >
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate font-semibold">
                                                {event.name}
                                            </span>
                                            {event.categories?.slice(0, 2).map((c) => (
                                                <Badge key={c} className="text-xs">
                                                    {c}
                                                </Badge>
                                            ))}
                                        </div>
                                        {event.description && (
                                            <span className="text-xs text-[var(--ag-colorTextDescription)]">
                                                {event.description}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </React.Fragment>
                        ))}

                        <ScrollSentinel
                            onVisible={requestMore}
                            hasMore={hasNextPage}
                            isFetching={isFetchingNextPage}
                        />

                        {isFetchingNextPage && (
                            <div className="flex items-center justify-center py-4">
                                <Spinner size="small" />
                            </div>
                        )}
                    </div>
                )}

                <ScrollToTopButton scrollRef={scrollRef} />
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Event detail — read-only `trigger_config` schema
// ---------------------------------------------------------------------------

function EventDetailView({
    integrationKey,
    event,
    onBack,
}: {
    integrationKey: string
    event: TriggerCatalogEvent
    onBack: () => void
}) {
    const {event: detail, isLoading} = useTriggerEvent(integrationKey, event.key)

    const schema = (detail?.trigger_config ?? null) as Record<string, unknown> | null

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex flex-col gap-2 px-6 pt-4 pb-3 shrink-0">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        aria-label="Go back"
                        onClick={onBack}
                        className="shrink-0 cursor-pointer bg-transparent border-0 p-0 inline-flex items-center"
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <span className="truncate flex-1 font-semibold">{event.name}</span>
                </div>
                {event.description && (
                    <p className="text-xs m-0 text-[var(--ag-colorTextDescription)]">
                        {event.description}
                    </p>
                )}
            </div>

            <Divider className="m-0" />

            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
                <span className="text-sm font-medium">Trigger configuration</span>
                <div className="mt-3">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Spinner />
                        </div>
                    ) : schema && Object.keys(schema).length > 0 ? (
                        <SchemaForm schema={schema} disabled />
                    ) : (
                        <EmptyState description="This event has no configuration" />
                    )}
                </div>
            </div>
        </div>
    )
}
