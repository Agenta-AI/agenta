import React, {useCallback, useMemo, useRef, useState} from "react"

import {
    triggerEventsDrawerAtom,
    triggerEventsSearchAtom,
    useTriggerCatalogEvents,
    useTriggerEvent,
    type TriggerCatalogEvent,
} from "@agenta/entities/gatewayTrigger"
import {Card, CardContent} from "@agenta/primitive-ui/components/card"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {ScrollSentinel, ScrollToTopButton} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowLeft, MagnifyingGlass} from "@phosphor-icons/react"
import {Divider, Empty, Form, Input, Spin, Tag} from "antd"
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
            size="large"
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
                <Input
                    placeholder="Search events…"
                    prefix={<MagnifyingGlass size={16} />}
                    value={search.value}
                    onChange={(e) => search.onChange(e.target.value)}
                    allowClear
                    onClear={() => search.onChange("")}
                />
                <span className="text-xs text-muted-foreground">
                    {total} event{total !== 1 ? "s" : ""}
                </span>
            </div>

            <Divider className="!m-0" />

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overscroll-contain px-6 py-3 relative"
            >
                {isLoading && events.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                        <Spin />
                    </div>
                ) : events.length === 0 ? (
                    <Empty description="No events found" />
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
                                <Card
                                    onClick={() => onSelect(event)}
                                    className="cursor-pointer transition-colors hover:bg-muted/30 hover:ring-foreground/20"
                                    size="sm"
                                >
                                    <CardContent>
                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate font-semibold">
                                                    {event.name}
                                                </span>
                                                {event.categories?.slice(0, 2).map((c) => (
                                                    <Tag key={c} className="text-xs">
                                                        {c}
                                                    </Tag>
                                                ))}
                                            </div>
                                            {event.description && (
                                                <span className="text-xs text-muted-foreground">
                                                    {event.description}
                                                </span>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </React.Fragment>
                        ))}

                        <ScrollSentinel
                            onVisible={requestMore}
                            hasMore={hasNextPage}
                            isFetching={isFetchingNextPage}
                        />

                        {isFetchingNextPage && (
                            <div className="flex items-center justify-center py-4">
                                <Spin size="small" />
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
    const [form] = Form.useForm()
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
                    <p className="!text-xs !mb-0 text-muted-foreground">{event.description}</p>
                )}
            </div>

            <Divider className="!m-0" />

            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
                <span className="text-sm font-medium">Trigger configuration</span>
                <div className="mt-3">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Spin />
                        </div>
                    ) : schema && Object.keys(schema).length > 0 ? (
                        <SchemaForm schema={schema} form={form} disabled />
                    ) : (
                        <Empty description="This event has no configuration" />
                    )}
                </div>
            </div>
        </div>
    )
}
