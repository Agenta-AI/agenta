import React, {useCallback, useMemo, useRef, useState} from "react"

import {
    isConnectionActive,
    toolActionsSearchAtom,
    toolCatalogDrawerOpenAtom,
    toolExecutionDrawerAtom,
    toolIntegrationsSearchAtom,
    useToolCatalogActions,
    useToolCatalogIntegrations,
    useToolIntegrationConnections,
    type ToolCatalogIntegration,
    type ToolCatalogIntegrationDetails,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {ScrollSentinel, ScrollToTopButton} from "@agenta/ui"
import {Tag} from "@agenta/ui/components/presentational"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {
    Button,
    Divider,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    EmptyState,
    InputAffix,
    Spinner,
} from "@agenta/ui/ui"
import {ArrowLeft, CaretDown, MagnifyingGlass, Plus} from "@phosphor-icons/react"
import {useAtom, useSetAtom} from "jotai"
import Image from "next/image"

import {CatalogCard, ExpandableText} from "../components/catalogPrimitives"

import ConnectDrawer from "./ConnectDrawer"

type CatalogIntegrationItem = ToolCatalogIntegration | ToolCatalogIntegrationDetails

// ---------------------------------------------------------------------------
// CatalogDrawer (root)
// ---------------------------------------------------------------------------

interface Props {
    onConnectionCreated?: () => void
}

export default function CatalogDrawer({onConnectionCreated}: Props) {
    const [open, setOpen] = useAtom(toolCatalogDrawerOpenAtom)
    const [selectedIntegration, setSelectedIntegration] = useState<CatalogIntegrationItem | null>(
        null,
    )
    const [connectIntegration, setConnectIntegration] = useState<CatalogIntegrationItem | null>(
        null,
    )

    const setIntegrationsSearch = useSetAtom(toolIntegrationsSearchAtom)
    const setActionsSearch = useSetAtom(toolActionsSearchAtom)

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

    const handleConnect = useCallback((integration: CatalogIntegrationItem) => {
        setConnectIntegration(integration)
    }, [])

    const handleConnectionSuccess = useCallback(() => {
        handleClose()
        onConnectionCreated?.()
    }, [handleClose, onConnectionCreated])

    return (
        <>
            <EnhancedDrawer
                open={open}
                onClose={handleClose}
                title={selectedIntegration ? "Browse Actions" : "Browse Integrations"}
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
                    <ActionsView
                        integration={selectedIntegration}
                        onBack={handleBack}
                        onConnect={() => handleConnect(selectedIntegration)}
                    />
                ) : (
                    <IntegrationsView onSelect={setSelectedIntegration} />
                )}
            </EnhancedDrawer>

            {connectIntegration && (
                <ConnectDrawer
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
// Integrations view (sticky header + scrollable content)
// ---------------------------------------------------------------------------

function IntegrationsView({onSelect}: {onSelect: (integration: CatalogIntegrationItem) => void}) {
    const setAtom = useSetAtom(toolIntegrationsSearchAtom)
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
    } = useToolCatalogIntegrations()

    const sentinelIndex = useMemo(
        () => Math.max(0, integrations.length - prefetchThreshold),
        [integrations.length, prefetchThreshold],
    )

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Sticky header */}
            <div className="flex flex-col gap-3 px-6 pt-4 pb-3 shrink-0">
                <InputAffix
                    placeholder="Search integrations…"
                    prefix={<MagnifyingGlass size={16} />}
                    value={search.value}
                    onValueChange={(value) => search.onChange(value)}
                    allowClear
                />
                <span className="text-xs text-colorTextDescription">
                    {total} integration{total !== 1 ? "s" : ""}
                </span>
            </div>

            <Divider className="!m-0" />

            {/* Scrollable content */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overscroll-contain px-6 py-3 relative"
            >
                {isLoading && integrations.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                        <Spinner />
                    </div>
                ) : integrations.length === 0 ? (
                    <EmptyState description="No integrations found" />
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
                                <CatalogCard
                                    onClick={() => onSelect(integration)}
                                    className="cursor-pointer"
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
                                                <span className="truncate font-medium">
                                                    {integration.name}
                                                </span>
                                                {integration.actions_count != null && (
                                                    <span className="inline-flex shrink-0 items-center rounded-full bg-colorInfo px-2 py-0.5 text-xs leading-4 text-white">
                                                        {integration.actions_count} actions
                                                    </span>
                                                )}
                                            </div>
                                            {integration.description && (
                                                <span className="text-xs text-colorTextDescription line-clamp-2">
                                                    {integration.description}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </CatalogCard>
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
// Actions view (sticky header + scrollable content)
// ---------------------------------------------------------------------------

function ActionsView({
    integration,
    onBack,
    onConnect,
}: {
    integration: CatalogIntegrationItem
    onBack: () => void
    onConnect: () => void
}) {
    const setAtom = useSetAtom(toolActionsSearchAtom)
    const search = useDebouncedAtomSearch(setAtom)
    const scrollRef = useRef<HTMLDivElement>(null)
    const setExecutionDrawer = useSetAtom(toolExecutionDrawerAtom)
    const {connections} = useToolIntegrationConnections(integration.key)

    const handleOpenConnection = useCallback(
        (conn: ToolConnection) => {
            setExecutionDrawer({
                connectionId: conn.id ?? "",
                connectionSlug: conn.slug ?? "",
                integrationKey: conn.integration_key,
                integrationName: integration.name,
                integrationLogo: integration.logo ?? undefined,
            })
        },
        [setExecutionDrawer, integration.name, integration.logo],
    )

    const {
        actions,
        total,
        prefetchThreshold,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        requestMore,
    } = useToolCatalogActions(integration.key)

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
                        variant="ghost"
                        size="icon"
                        aria-label="Go back"
                        onClick={onBack}
                        className="shrink-0"
                    >
                        <ArrowLeft size={16} />
                    </Button>
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
                    <span className="truncate flex-1 font-medium">{integration.name}</span>
                    <div className="shrink-0">
                        {connections.length > 0 ? (
                            // Was antd `Dropdown.Button` — a split primary button: main
                            // action connects, the caret opens the connections menu.
                            <div className="flex items-stretch gap-px">
                                <Button onClick={onConnect} className="rounded-r-none">
                                    <Plus size={14} />
                                    Connect
                                </Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            aria-label="Open connections"
                                            size="icon"
                                            className="rounded-l-none"
                                        >
                                            <CaretDown size={12} />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        {connections.map((conn) => (
                                            <DropdownMenuItem
                                                key={conn.id ?? conn.slug ?? ""}
                                                onClick={() => handleOpenConnection(conn)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate">
                                                        {conn.name || conn.slug}
                                                    </span>
                                                    {isConnectionActive(conn) && (
                                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                                                    )}
                                                </div>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        ) : (
                            <Button onClick={onConnect}>
                                <Plus size={14} />
                                Connect
                            </Button>
                        )}
                    </div>
                </div>
                {integration.description && <ExpandableText text={integration.description} />}

                <InputAffix
                    placeholder="Search actions…"
                    prefix={<MagnifyingGlass size={16} />}
                    value={search.value}
                    onValueChange={(value) => search.onChange(value)}
                    allowClear
                />

                <span className="text-xs text-colorTextDescription">
                    {total} action{total !== 1 ? "s" : ""}
                </span>
            </div>

            <Divider className="!m-0" />

            {/* Scrollable content */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overscroll-contain px-6 py-3 relative"
            >
                {isLoading && actions.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                        <Spinner />
                    </div>
                ) : actions.length === 0 ? (
                    <EmptyState description="No actions found" />
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
                                <CatalogCard className="cursor-pointer">
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate font-medium">
                                                {action.name}
                                            </span>
                                            {action.categories?.slice(0, 2).map((c) => (
                                                <Tag key={c} tone="default" className="text-xs">
                                                    {c}
                                                </Tag>
                                            ))}
                                        </div>
                                        {action.description && (
                                            <span className="text-xs text-colorTextDescription">
                                                {action.description}
                                            </span>
                                        )}
                                    </div>
                                </CatalogCard>
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
