import React, {useCallback, useMemo, useRef, useState} from "react"

import {
    isConnectionActive,
    triggerCatalogDrawerOpenAtom,
    triggerEventsDrawerAtom,
    triggerEventsSearchAtom,
    triggerIntegrationsSearchAtom,
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
    useTriggerIntegrationConnections,
    type TriggerCatalogEvent,
    type TriggerCatalogIntegration,
    type TriggerConnection,
} from "@agenta/entities/gatewayTrigger"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {ScrollSentinel, ScrollToTopButton} from "@agenta/ui"
import {ArrowLeft, CaretDown, MagnifyingGlass, Plus} from "@phosphor-icons/react"
import type {MenuProps} from "antd"
import {
    Badge,
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
}

export default function TriggerCatalogDrawer({onConnectionCreated}: Props) {
    const [open, setOpen] = useAtom(triggerCatalogDrawerOpenAtom)
    const [selectedIntegration, setSelectedIntegration] =
        useState<TriggerCatalogIntegration | null>(null)
    const [connectIntegration, setConnectIntegration] = useState<TriggerCatalogIntegration | null>(
        null,
    )

    const setIntegrationsSearch = useSetAtom(triggerIntegrationsSearchAtom)
    const setEventsSearch = useSetAtom(triggerEventsSearchAtom)

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

    return (
        <>
            <Drawer
                open={open}
                onClose={handleClose}
                title={selectedIntegration ? "Browse Events" : "Browse Integrations"}
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
                    />
                ) : (
                    <IntegrationsView onSelect={setSelectedIntegration} />
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
// Integrations view
// ---------------------------------------------------------------------------

function IntegrationsView({
    onSelect,
}: {
    onSelect: (integration: TriggerCatalogIntegration) => void
}) {
    const setAtom = useSetAtom(triggerIntegrationsSearchAtom)
    const search = useDebouncedAtomSearch(setAtom)
    const scrollRef = useRef<HTMLDivElement>(null)

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

    if (isLoading && integrations.length === 0) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spin />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex flex-col gap-3 px-6 pt-4 pb-3 shrink-0">
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
                className="flex-1 overflow-y-auto overscroll-contain px-6 py-3 relative"
            >
                {integrations.length === 0 ? (
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
                                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <Typography.Text strong className="truncate">
                                                    {integration.name}
                                                </Typography.Text>
                                                {integration.actions_count != null && (
                                                    <Badge
                                                        count={`${integration.actions_count} actions`}
                                                        size="small"
                                                        color="blue"
                                                    />
                                                )}
                                            </div>
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
}: {
    integration: TriggerCatalogIntegration
    onBack: () => void
    onConnect: () => void
}) {
    const setAtom = useSetAtom(triggerEventsSearchAtom)
    const search = useDebouncedAtomSearch(setAtom)
    const scrollRef = useRef<HTMLDivElement>(null)
    const setEventsDrawer = useSetAtom(triggerEventsDrawerAtom)
    const {connections} = useTriggerIntegrationConnections(integration.key)

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
                    <Empty description="No events found" />
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
                                <Card hoverable className="cursor-pointer" size="small">
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
