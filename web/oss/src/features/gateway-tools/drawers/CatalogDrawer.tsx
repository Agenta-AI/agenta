import React, {useCallback, useMemo, useRef, useState} from "react"

import {ArrowLeft, CaretDown, MagnifyingGlass, Plus} from "@phosphor-icons/react"
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
import type {MenuProps} from "antd"
import {useAtom, useSetAtom} from "jotai"
import Image from "next/image"

import type {ConnectionItem, IntegrationItem} from "@/oss/services/tools/api/types"

import ScrollSentinel from "../components/ScrollSentinel"
import ScrollToTopButton from "../components/ScrollToTopButton"
import {useCatalogActions, actionsSearchAtom} from "../hooks/useCatalogActions"
import {useCatalogIntegrations, integrationsSearchAtom} from "../hooks/useCatalogIntegrations"
import {useDebouncedAtomSearch} from "../hooks/useDebouncedAtomSearch"
import {useIntegrationConnections} from "../hooks/useIntegrationConnections"
import {catalogDrawerOpenAtom, executionDrawerAtom} from "../state/atoms"

import ConnectDrawer from "./ConnectDrawer"

// ---------------------------------------------------------------------------
// Expandable description — 2-line clamp with inline "see more" / "see less"
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
// CatalogDrawer (root)
// ---------------------------------------------------------------------------

interface Props {
    onConnectionCreated?: () => void
}

export default function CatalogDrawer({onConnectionCreated}: Props) {
    const [open, setOpen] = useAtom(catalogDrawerOpenAtom)
    const [selectedIntegration, setSelectedIntegration] = useState<IntegrationItem | null>(null)
    const [connectIntegration, setConnectIntegration] = useState<IntegrationItem | null>(null)

    const setIntegrationsSearch = useSetAtom(integrationsSearchAtom)
    const setActionsSearch = useSetAtom(actionsSearchAtom)

    const handleClose = useCallback(() => {
        setOpen(false)
        setSelectedIntegration(null)
        setConnectIntegration(null)
        setIntegrationsSearch("")
        setActionsSearch("")
    }, [setOpen, setIntegrationsSearch, setActionsSearch])

    const handleBack = useCallback(() => {
        setSelectedIntegration(null)
        setActionsSearch("")
    }, [setActionsSearch])

    const handleConnect = useCallback((integration: IntegrationItem) => {
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
                title={selectedIntegration ? "Browse Actions" : "Browse Integrations"}
                width={540}
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
                    <ActionsView
                        integration={selectedIntegration}
                        onBack={handleBack}
                        onConnect={() => handleConnect(selectedIntegration)}
                    />
                ) : (
                    <IntegrationsView onSelect={setSelectedIntegration} />
                )}
            </Drawer>

            {connectIntegration && (
                <ConnectDrawer
                    open={!!connectIntegration}
                    integrationKey={connectIntegration.key}
                    integrationName={connectIntegration.name}
                    integrationLogo={connectIntegration.logo}
                    integrationDescription={connectIntegration.description}
                    authSchemes={connectIntegration.auth_schemes ?? []}
                    onClose={() => setConnectIntegration(null)}
                    onSuccess={handleConnectionSuccess}
                />
            )}
        </>
    )
}

// ---------------------------------------------------------------------------
// Integrations view (sticky header + scrollable content)
// ---------------------------------------------------------------------------

function IntegrationsView({onSelect}: {onSelect: (integration: IntegrationItem) => void}) {
    const setAtom = useSetAtom(integrationsSearchAtom)
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
    } = useCatalogIntegrations()

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
            {/* Sticky header */}
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

            {/* Scrollable content */}
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

                        {/* Bottom sentinel — fallback trigger for the threshold→end zone */}
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
// Actions view (sticky header + scrollable content)
// ---------------------------------------------------------------------------

function ActionsView({
    integration,
    onBack,
    onConnect,
}: {
    integration: IntegrationItem
    onBack: () => void
    onConnect: () => void
}) {
    const setAtom = useSetAtom(actionsSearchAtom)
    const search = useDebouncedAtomSearch(setAtom)
    const scrollRef = useRef<HTMLDivElement>(null)
    const setExecutionDrawer = useSetAtom(executionDrawerAtom)
    const {connections} = useIntegrationConnections(integration.key)

    const handleOpenConnection = useCallback(
        (conn: ConnectionItem) => {
            setExecutionDrawer({
                connectionId: conn.id,
                connectionSlug: conn.slug,
                integrationKey: conn.integration_key,
                integrationName: integration.name,
                integrationLogo: integration.logo,
            })
        },
        [setExecutionDrawer, integration.name, integration.logo],
    )

    const connectMenuItems = useMemo<MenuProps["items"]>(
        () =>
            connections.map((conn) => ({
                key: conn.id,
                label: (
                    <div className="flex items-center gap-2">
                        <span className="truncate">{conn.name || conn.slug}</span>
                        {conn.flags?.is_active && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        )}
                    </div>
                ),
                onClick: () => handleOpenConnection(conn),
            })),
        [connections, handleOpenConnection],
    )

    const {
        actions,
        total,
        prefetchThreshold,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        requestMore,
    } = useCatalogActions(integration.key)

    const sentinelIndex = useMemo(
        () => Math.max(0, actions.length - prefetchThreshold),
        [actions.length, prefetchThreshold],
    )

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Sticky header */}
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
                    placeholder="Search actions…"
                    prefix={<MagnifyingGlass size={16} />}
                    value={search.value}
                    onChange={(e) => search.onChange(e.target.value)}
                    allowClear
                    onClear={() => search.onChange("")}
                />

                <Typography.Text type="secondary" className="text-xs">
                    {total} action{total !== 1 ? "s" : ""}
                </Typography.Text>
            </div>

            <Divider className="!m-0" />

            {/* Scrollable content */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overscroll-contain px-6 py-3 relative"
            >
                {isLoading && actions.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                        <Spin />
                    </div>
                ) : actions.length === 0 ? (
                    <Empty description="No actions found" />
                ) : (
                    <div className="flex flex-col gap-2">
                        {actions.map((action, i) => (
                            <React.Fragment key={action.key}>
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
                                                {action.name}
                                            </Typography.Text>
                                            {action.categories?.slice(0, 2).map((c) => (
                                                <Tag key={c} className="text-xs">
                                                    {c}
                                                </Tag>
                                            ))}
                                        </div>
                                        {action.description && (
                                            <Typography.Text type="secondary" className="text-xs">
                                                {action.description}
                                            </Typography.Text>
                                        )}
                                    </div>
                                </Card>
                            </React.Fragment>
                        ))}

                        {/* Bottom sentinel — fallback trigger for the threshold→end zone */}
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
