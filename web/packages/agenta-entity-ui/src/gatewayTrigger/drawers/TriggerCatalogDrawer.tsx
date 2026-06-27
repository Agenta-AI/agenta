import React, {useCallback, useMemo, useRef, useState} from "react"

import {
    isConnectionActive,
    triggerCatalogDrawerOpenAtom,
    triggerEventsDrawerAtom,
    triggerEventsSearchAtom,
    triggerIntegrationsSearchAtom,
    triggerSubscriptionDrawerAtom,
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
    useTriggerConnectionsQuery,
    useTriggerIntegrationConnections,
    type TriggerCatalogEvent,
    type TriggerCatalogIntegration,
    type TriggerConnection,
} from "@agenta/entities/gatewayTrigger"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {ScrollSentinel, ScrollToTopButton} from "@agenta/ui"
import {
    ArrowLeft,
    CaretDown,
    CaretRight,
    Lightning,
    MagnifyingGlass,
    Plus,
} from "@phosphor-icons/react"
import type {MenuProps} from "antd"
import {
    Button,
    Card,
    Divider,
    Drawer,
    Dropdown,
    Empty,
    Input,
    Spin,
    Tag,
    Typography,
    message,
} from "antd"
import {useAtom, useSetAtom} from "jotai"
import Image from "next/image"

import TriggerConnectDrawer from "./TriggerConnectDrawer"

// ---------------------------------------------------------------------------
// Expandable description — 2-line clamp with inline "see more" / "see less"
// (identical to gatewayTool CatalogDrawer).
// ---------------------------------------------------------------------------

function ExpandableText({text}: {text: string}) {
    return (
        <Typography.Paragraph
            type="secondary"
            className="!text-xs !mb-0"
            ellipsis={{
                rows: 3,
                expandable: "collapsible",
                symbol: (expanded) => (expanded ? "see less" : "see more"),
            }}
        >
            {text}
        </Typography.Paragraph>
    )
}

// ---------------------------------------------------------------------------
// TriggerCatalogDrawer (root) — mirrors gatewayTool CatalogDrawer with the
// tools "action" leaf swapped for the triggers "event" leaf.
// ---------------------------------------------------------------------------

interface Props {
    onConnectionCreated?: () => void
    /**
     * Pre-bind any subscription created from this catalog (by picking an event)
     * to a workflow — e.g. the current agent when opened from its config panel.
     * Keyed like `data.references` (`application`/`application_variant`).
     */
    defaultReferences?: Record<string, {id?: string; slug?: string}>
    /** Human-readable label for `defaultReferences` (e.g. the agent's name). */
    defaultBoundLabel?: string
    /** Agent entityId for the subscription drawer's "Run in playground" action. */
    playgroundEntityId?: string
}

export default function TriggerCatalogDrawer({
    onConnectionCreated,
    defaultReferences,
    defaultBoundLabel,
    playgroundEntityId,
}: Props) {
    const [open, setOpen] = useAtom(triggerCatalogDrawerOpenAtom)
    const [selectedIntegration, setSelectedIntegration] =
        useState<TriggerCatalogIntegration | null>(null)
    const [connectIntegration, setConnectIntegration] = useState<TriggerCatalogIntegration | null>(
        null,
    )

    const setIntegrationsSearch = useSetAtom(triggerIntegrationsSearchAtom)
    const setEventsSearch = useSetAtom(triggerEventsSearchAtom)
    const openSubscription = useSetAtom(triggerSubscriptionDrawerAtom)

    const handleClose = useCallback(() => {
        setOpen(false)
        setSelectedIntegration(null)
        setConnectIntegration(null)
        setIntegrationsSearch("")
        setEventsSearch("")
    }, [setOpen, setIntegrationsSearch, setEventsSearch])

    const handleBack = useCallback(() => {
        setSelectedIntegration(null)
        setEventsSearch("")
    }, [setEventsSearch])

    const handleConnect = useCallback((integration: TriggerCatalogIntegration) => {
        setConnectIntegration(integration)
    }, [])

    const handleConnectionSuccess = useCallback(() => {
        handleClose()
        onConnectionCreated?.()
    }, [handleClose, onConnectionCreated])

    // Picking an event leaves the catalog and opens the subscription config drawer,
    // prefilled with the chosen connection + event and pre-bound via defaultReferences.
    const handleCreateFromEvent = useCallback(
        (connectionId: string, eventKey: string) => {
            const integration = selectedIntegration
            handleClose()
            openSubscription({
                connectionId,
                integrationKey: integration?.key,
                integrationName: integration?.name,
                eventKey,
                defaultReferences,
                defaultBoundLabel,
                playgroundEntityId,
            })
        },
        [
            selectedIntegration,
            handleClose,
            openSubscription,
            defaultReferences,
            defaultBoundLabel,
            playgroundEntityId,
        ],
    )

    // Reuse an EXISTING connection: jump straight to that app's events (skipping
    // the integration browse). Picking an event there opens the subscription drawer
    // with the connection resolved — the same proven path as the browse flow.
    const handlePickConnection = useCallback((connection: TriggerConnection) => {
        if (!connection.integration_key) return
        setSelectedIntegration({
            key: connection.integration_key,
            name: connection.name || connection.integration_key,
        } as TriggerCatalogIntegration)
    }, [])

    // Picking an event under an existing connection creates the trigger directly —
    // same as the browse → event path, but the connection is already known.
    const handleCreateFromConnectionEvent = useCallback(
        (connection: TriggerConnection, eventKey: string) => {
            if (!connection.id) return
            handleClose()
            openSubscription({
                connectionId: connection.id,
                integrationKey: connection.integration_key,
                integrationName: connection.name ?? connection.integration_key,
                eventKey,
                defaultReferences,
                defaultBoundLabel,
                playgroundEntityId,
            })
        },
        [handleClose, openSubscription, defaultReferences, defaultBoundLabel, playgroundEntityId],
    )

    return (
        <>
            <Drawer
                open={open}
                onClose={handleClose}
                title={selectedIntegration ? "Choose an event" : "Add an app trigger"}
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
                {selectedIntegration ? (
                    <EventsView
                        integration={selectedIntegration}
                        onBack={handleBack}
                        onConnect={() => handleConnect(selectedIntegration)}
                        onCreateFromEvent={handleCreateFromEvent}
                    />
                ) : (
                    <IntegrationsView
                        onSelect={setSelectedIntegration}
                        onPickConnection={handlePickConnection}
                        onCreateFromConnectionEvent={handleCreateFromConnectionEvent}
                    />
                )}
            </Drawer>

            {connectIntegration && (
                <TriggerConnectDrawer
                    open={!!connectIntegration}
                    integrationKey={connectIntegration.key}
                    integrationName={connectIntegration.name}
                    integrationLogo={connectIntegration.logo ?? undefined}
                    integrationDescription={connectIntegration.description ?? undefined}
                    authSchemes={connectIntegration.auth_schemes ?? []}
                    onClose={() => setConnectIntegration(null)}
                    onSuccess={handleConnectionSuccess}
                />
            )}
        </>
    )
}

// ---------------------------------------------------------------------------
// ConnectionEventsList — lazy-loaded trigger events for one connection's
// integration (mounted only when its accordion row is expanded). Picking an
// event creates the trigger directly.
// ---------------------------------------------------------------------------

function ConnectionEventsList({
    connection,
    onPickEvent,
    onViewAll,
}: {
    connection: TriggerConnection
    onPickEvent: (eventKey: string) => void
    onViewAll: () => void
}) {
    const {events, isLoading, hasNextPage} = useTriggerCatalogEvents(connection.integration_key)

    if (isLoading && events.length === 0) {
        return (
            <div className="flex justify-center py-3">
                <Spin size="small" />
            </div>
        )
    }
    if (events.length === 0) {
        return (
            <div className="px-3 py-2 text-[11px] text-[var(--ag-colorTextTertiary)]">
                No events for this app
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-0.5 p-1">
            {events.map((ev) => (
                <button
                    key={ev.key}
                    type="button"
                    onClick={() => onPickEvent(ev.key)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-2 py-1.5 text-left hover:bg-[var(--ag-colorFillSecondary)]"
                >
                    <Lightning size={13} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {ev.name || ev.key}
                    </span>
                    <Plus size={13} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
                </button>
            ))}
            {hasNextPage && (
                <button
                    type="button"
                    onClick={onViewAll}
                    className="flex w-full cursor-pointer border-0 bg-transparent px-2 py-1.5 text-left text-[12px] text-[var(--ag-colorTextSecondary)] hover:bg-[var(--ag-colorFillSecondary)]"
                >
                    View all events…
                </button>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Integrations view
// ---------------------------------------------------------------------------

function IntegrationsView({
    onSelect,
    onPickConnection,
    onCreateFromConnectionEvent,
}: {
    onSelect: (integration: TriggerCatalogIntegration) => void
    onPickConnection: (connection: TriggerConnection) => void
    onCreateFromConnectionEvent: (connection: TriggerConnection, eventKey: string) => void
}) {
    const setAtom = useSetAtom(triggerIntegrationsSearchAtom)
    const search = useDebouncedAtomSearch(setAtom)
    const scrollRef = useRef<HTMLDivElement>(null)
    const {connections} = useTriggerConnectionsQuery()
    const [expandedConn, setExpandedConn] = useState<string | null>(null)

    const {
        integrations,
        total,
        prefetchThreshold,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        requestMore,
    } = useTriggerCatalogIntegrations()

    const sentinelIndex = useMemo(
        () => Math.max(0, integrations.length - prefetchThreshold),
        [integrations.length, prefetchThreshold],
    )

    const hasConnections = connections.length > 0

    return (
        <div className="flex h-full min-h-0 overflow-hidden">
            {hasConnections && (
                <div className="flex w-[280px] shrink-0 flex-col overflow-hidden border-0 border-r border-solid border-[var(--ag-colorBorderSecondary)]">
                    <div className="shrink-0 px-4 pb-2 pt-4">
                        <Typography.Text type="secondary" className="text-xs">
                            Your connections
                        </Typography.Text>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain px-3 pb-2">
                        {connections.map((conn) => {
                            const cid = conn.id ?? conn.slug ?? conn.integration_key ?? ""
                            const isOpen = expandedConn === cid
                            return (
                                <div
                                    key={cid}
                                    className="overflow-hidden rounded border border-solid border-[var(--ag-colorBorderSecondary)]"
                                >
                                    <button
                                        type="button"
                                        onClick={() => setExpandedConn(isOpen ? null : cid)}
                                        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2.5 py-2 text-left hover:bg-[var(--ag-colorFillSecondary)]"
                                    >
                                        {isOpen ? (
                                            <CaretDown
                                                size={12}
                                                className="shrink-0 text-[var(--ag-colorTextTertiary)]"
                                            />
                                        ) : (
                                            <CaretRight
                                                size={12}
                                                className="shrink-0 text-[var(--ag-colorTextTertiary)]"
                                            />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-xs font-medium">
                                                {conn.name || conn.slug || conn.integration_key}
                                            </div>
                                            <div className="truncate text-[11px] text-[var(--ag-colorTextTertiary)]">
                                                {conn.integration_key}
                                            </div>
                                        </div>
                                        {isConnectionActive(conn) && (
                                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                                        )}
                                    </button>
                                    {isOpen && (
                                        <div className="border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)]">
                                            <ConnectionEventsList
                                                connection={conn}
                                                onPickEvent={(eventKey) =>
                                                    onCreateFromConnectionEvent(conn, eventKey)
                                                }
                                                onViewAll={() => onPickConnection(conn)}
                                            />
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    <div className="mt-auto flex shrink-0 items-start gap-1.5 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] px-4 py-3 text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                        <Lightning size={13} className="mt-[1px] shrink-0" />
                        <span>Pick an event to create a trigger — no setup needed.</span>
                    </div>
                </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex shrink-0 flex-col gap-2 px-6 pb-3 pt-4">
                    <Typography.Text type="secondary" className="text-xs">
                        {hasConnections ? "Or connect a new app" : "Connect an app"}
                    </Typography.Text>
                    <Input
                        placeholder="Search integrations…"
                        prefix={<MagnifyingGlass size={16} />}
                        value={search.value}
                        onChange={(e) => search.onChange(e.target.value)}
                        allowClear
                        onClear={() => search.onChange("")}
                    />
                    <Typography.Text type="secondary" className="text-xs">
                        {total} integration{total !== 1 ? "s" : ""}
                    </Typography.Text>
                </div>

                <Divider className="!m-0" />

                <div
                    ref={scrollRef}
                    className="relative flex-1 overflow-y-auto overscroll-contain px-6 py-3"
                >
                    {isLoading && integrations.length === 0 ? (
                        <div className="flex items-center justify-center py-12">
                            <Spin />
                        </div>
                    ) : integrations.length === 0 ? (
                        <Empty description="No integrations found" />
                    ) : (
                        <div className="flex flex-col gap-2">
                            {integrations.map((integration, i) => (
                                <React.Fragment key={integration.key}>
                                    {i === sentinelIndex && (
                                        <ScrollSentinel
                                            onVisible={requestMore}
                                            hasMore={hasNextPage}
                                            isFetching={isFetchingNextPage}
                                        />
                                    )}
                                    <Card
                                        hoverable
                                        onClick={() => onSelect(integration)}
                                        className="cursor-pointer"
                                        size="small"
                                    >
                                        <div className="flex items-start gap-3">
                                            {integration.logo && (
                                                <Image
                                                    src={integration.logo}
                                                    alt={integration.name}
                                                    width={32}
                                                    height={32}
                                                    className="w-8 h-8 rounded object-contain shrink-0"
                                                    unoptimized
                                                />
                                            )}
                                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                <Typography.Text strong className="truncate">
                                                    {integration.name}
                                                </Typography.Text>
                                                {integration.description && (
                                                    <Typography.Text
                                                        type="secondary"
                                                        className="text-xs line-clamp-2"
                                                    >
                                                        {integration.description}
                                                    </Typography.Text>
                                                )}
                                            </div>
                                        </div>
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
        </div>
    )
}

// ---------------------------------------------------------------------------
// Events view — browse an integration's events; Connect + open-events on a
// chosen existing connection (mirrors tools ActionsView).
// ---------------------------------------------------------------------------

function EventsView({
    integration,
    onBack,
    onConnect,
    onCreateFromEvent,
}: {
    integration: TriggerCatalogIntegration
    onBack: () => void
    onConnect: () => void
    onCreateFromEvent: (connectionId: string, eventKey: string) => void
}) {
    const setAtom = useSetAtom(triggerEventsSearchAtom)
    const search = useDebouncedAtomSearch(setAtom)
    const scrollRef = useRef<HTMLDivElement>(null)
    const setEventsDrawer = useSetAtom(triggerEventsDrawerAtom)
    const {connections} = useTriggerIntegrationConnections(integration.key)

    // Picking an event needs a connection to bind. Prefer an active one; fall back
    // to the first connection. With none, the user must Connect first.
    const handlePickEvent = useCallback(
        (event: TriggerCatalogEvent) => {
            const connection = connections.find((c) => isConnectionActive(c)) ?? connections[0]
            if (!connection?.id) {
                message.info("Connect this integration first to create a trigger")
                return
            }
            onCreateFromEvent(connection.id, event.key)
        },
        [connections, onCreateFromEvent],
    )

    const handleOpenConnectionEvents = useCallback(
        (conn: TriggerConnection) => {
            setEventsDrawer({
                providerKey: conn.provider_key ?? "composio",
                integrationKey: conn.integration_key,
                integrationName: integration.name,
                connectionId: conn.id ?? undefined,
            })
        },
        [setEventsDrawer, integration.name],
    )

    const connectMenuItems = useMemo<MenuProps["items"]>(
        () =>
            connections.map((conn) => ({
                key: conn.id ?? conn.slug ?? "",
                label: (
                    <div className="flex items-center gap-2">
                        <span className="truncate">{conn.name || conn.slug}</span>
                        {isConnectionActive(conn) && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        )}
                    </div>
                ),
                onClick: () => handleOpenConnectionEvents(conn),
            })),
        [connections, handleOpenConnectionEvents],
    )

    const {
        events,
        total,
        prefetchThreshold,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        requestMore,
    } = useTriggerCatalogEvents(integration.key)

    const sentinelIndex = useMemo(
        () => Math.max(0, events.length - prefetchThreshold),
        [events.length, prefetchThreshold],
    )

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex flex-col gap-3 px-6 pt-4 pb-3 shrink-0">
                <div className="flex items-center gap-3">
                    <Button
                        type="text"
                        aria-label="Go back"
                        icon={<ArrowLeft size={16} />}
                        onClick={onBack}
                        className="shrink-0"
                    />
                    {integration.logo && (
                        <Image
                            src={integration.logo}
                            alt={integration.name}
                            width={32}
                            height={32}
                            className="w-8 h-8 rounded object-contain shrink-0"
                            unoptimized
                        />
                    )}
                    <Typography.Text strong className="truncate flex-1">
                        {integration.name}
                    </Typography.Text>
                    <div className="shrink-0">
                        {connections.length > 0 ? (
                            <Dropdown.Button
                                type="primary"
                                trigger={["click"]}
                                menu={{items: connectMenuItems}}
                                icon={<CaretDown size={12} />}
                                onClick={onConnect}
                            >
                                <Plus size={14} />
                                Connect
                            </Dropdown.Button>
                        ) : (
                            <Button type="primary" icon={<Plus size={14} />} onClick={onConnect}>
                                Connect
                            </Button>
                        )}
                    </div>
                </div>
                {integration.description && <ExpandableText text={integration.description} />}

                <Input
                    placeholder="Search events…"
                    prefix={<MagnifyingGlass size={16} />}
                    value={search.value}
                    onChange={(e) => search.onChange(e.target.value)}
                    allowClear
                    onClear={() => search.onChange("")}
                />

                <Typography.Text type="secondary" className="text-xs">
                    {total} event{total !== 1 ? "s" : ""}
                </Typography.Text>
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
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="This app has no triggers"
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        {events.map((event: TriggerCatalogEvent, i) => (
                            <React.Fragment key={event.key}>
                                {i === sentinelIndex && (
                                    <ScrollSentinel
                                        onVisible={requestMore}
                                        hasMore={hasNextPage}
                                        isFetching={isFetchingNextPage}
                                    />
                                )}
                                <Card
                                    hoverable
                                    className="cursor-pointer"
                                    size="small"
                                    onClick={() => handlePickEvent(event)}
                                >
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                            <Typography.Text strong className="truncate">
                                                {event.name}
                                            </Typography.Text>
                                            {event.categories?.slice(0, 2).map((c) => (
                                                <Tag key={c} className="text-xs">
                                                    {c}
                                                </Tag>
                                            ))}
                                        </div>
                                        {event.description && (
                                            <Typography.Text type="secondary" className="text-xs">
                                                {event.description}
                                            </Typography.Text>
                                        )}
                                    </div>
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
