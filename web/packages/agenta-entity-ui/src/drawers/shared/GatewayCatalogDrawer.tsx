/**
 * GatewayCatalogDrawer
 *
 * The shared Composio catalog drawer used by BOTH the triggers catalog (pick an event → create a
 * subscription) and the tools catalog (pick an action → add it as a tool). One implementation:
 * a "Your connections" rail (expandable connection → items) + a searchable "All apps" grid +
 * inline connect. Surfaces differ only in data + leaf, supplied via `adapter` + `config`.
 *
 * Tools and triggers share the same `gateway_connections` rows, so this drawer is genuinely the
 * same component pointed at different catalog hooks. Dark-safe (`--ag-color*` tokens + antd).
 */
import React, {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {Card, CardContent} from "@agenta/primitive-ui/components/card"
import {ScrollSentinel, ScrollToTopButton} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {
    ArrowLeft,
    CaretDown,
    CaretRight,
    Check,
    Lightning,
    MagnifyingGlass,
    Plus,
} from "@phosphor-icons/react"
import type {MenuProps} from "antd"
import {Button, Divider, Dropdown, Empty, Input, Spin, Tag} from "antd"
import Image from "next/image"

import {AppCard} from "./CatalogAppCard"

interface InfiniteList<X> {
    total: number
    prefetchThreshold: number
    isLoading: boolean
    hasNextPage: boolean
    isFetchingNextPage: boolean
    requestMore: () => void
    items: X[]
}

/** Data layer — parallel trigger/tool catalog hooks + field accessors (shapes differ per surface). */
export interface CatalogAdapter<I, T, C> {
    useIntegrations: () => InfiniteList<I>
    useConnections: () => {connections: C[]}
    useIntegrationConnections: (integrationKey: string) => {connections: C[]}
    useItems: (integrationKey: string) => InfiniteList<T>
    isConnectionActive: (c: C) => boolean
    /** Build a minimal integration from a connection (rail "view all" navigates to its items). */
    integrationFromConnection: (c: C) => I
    setIntegrationsSearch: (search: string) => void
    setItemsSearch: (search: string) => void
    integration: {
        key: (i: I) => string
        name: (i: I) => string
        logo: (i: I) => string | undefined
        description: (i: I) => string | undefined
        authSchemes: (i: I) => string[]
        categories?: (i: I) => string[] | undefined
        itemCount?: (i: I) => number | undefined
    }
    connection: {
        id: (c: C) => string | undefined
        name: (c: C) => string | undefined
        slug: (c: C) => string | undefined
        integrationKey: (c: C) => string
    }
    item: {
        key: (t: T) => string
        name: (t: T) => string | undefined
        description?: (t: T) => string | undefined
        categories?: (t: T) => string[] | undefined
    }
}

export type ItemTrailing = "add" | "selected" | "pending"

/** Presentation + leaf behavior. */
export interface CatalogConfig<I, T, C> {
    /** Drawer title; receives the selected integration (items view) or null (browse). */
    title: (selected: I | null) => string
    appsSearchPlaceholder: string
    itemsSearchPlaceholder: string
    /** Footer hint in the connections rail. */
    connectionsHint: ReactNode
    /** Empty state when an app exposes no items. */
    emptyItemsText: string
    /** Pick an item bound to a connection. `integration` is set in the items view, null from the rail. */
    onPickItem: (connection: C, item: T, integration: I | null) => void
    /** Trailing affordance per item (tools track selected/pending). Defaults to "add". */
    itemTrailing?: (connection: C | null, item: T) => ItemTrailing
    /** Optional items-view "Connect" split-menu of existing connections (triggers: open events drawer). */
    onConnectionMenu?: (connection: C) => void
    /** Render the connect flow (ConnectDrawer / TriggerConnectDrawer) for the chosen integration. */
    renderConnect: (
        integration: I,
        handlers: {onClose: () => void; onSuccess: () => void},
    ) => ReactNode
}

function ExpandableText({text}: {text: string}) {
    const [expanded, setExpanded] = useState(false)
    return (
        <div className="text-xs text-muted-foreground">
            <p className={expanded ? "mb-0" : "mb-0 line-clamp-3"}>{text}</p>
            <button
                type="button"
                className="border-0 bg-transparent p-0 text-xs text-primary hover:underline"
                onClick={() => setExpanded((value) => !value)}
            >
                {expanded ? "see less" : "see more"}
            </button>
        </div>
    )
}

function ItemTrailingIcon({state}: {state: ItemTrailing}) {
    if (state === "pending") return <Spin size="small" />
    if (state === "selected")
        return <Check size={13} className="shrink-0 text-[var(--ag-colorPrimary)]" />
    return <Plus size={13} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
}

// Lazy-loaded items for one connection's integration (mounted only when its rail row is expanded).
function ConnectionItemsList<I, T, C>({
    connection,
    adapter,
    config,
    onViewAll,
}: {
    connection: C
    adapter: CatalogAdapter<I, T, C>
    config: CatalogConfig<I, T, C>
    onViewAll: () => void
}) {
    const {items, isLoading, hasNextPage} = adapter.useItems(
        adapter.connection.integrationKey(connection),
    )

    if (isLoading && items.length === 0) {
        return (
            <div className="flex justify-center py-3">
                <Spin size="small" />
            </div>
        )
    }
    if (items.length === 0) {
        return (
            <div className="px-3 py-2 text-[11px] text-[var(--ag-colorTextTertiary)]">
                {config.emptyItemsText}
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-0.5 p-1">
            {items.map((it) => {
                const state = config.itemTrailing?.(connection, it) ?? "add"
                return (
                    <button
                        key={adapter.item.key(it)}
                        type="button"
                        onClick={() =>
                            state !== "pending" && config.onPickItem(connection, it, null)
                        }
                        className="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-2 py-1.5 text-left hover:bg-[var(--ag-colorFillSecondary)]"
                    >
                        <Lightning
                            size={13}
                            className="shrink-0 text-[var(--ag-colorTextTertiary)]"
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">
                            {adapter.item.name(it) || adapter.item.key(it)}
                        </span>
                        <ItemTrailingIcon state={state} />
                    </button>
                )
            })}
            {hasNextPage && (
                <button
                    type="button"
                    onClick={onViewAll}
                    className="flex w-full cursor-pointer border-0 bg-transparent px-2 py-1.5 text-left text-[12px] text-[var(--ag-colorTextSecondary)] hover:bg-[var(--ag-colorFillSecondary)]"
                >
                    View all…
                </button>
            )}
        </div>
    )
}

function IntegrationsView<I, T, C>({
    adapter,
    config,
    onSelect,
}: {
    adapter: CatalogAdapter<I, T, C>
    config: CatalogConfig<I, T, C>
    onSelect: (integration: I) => void
}) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const [searchValue, setSearchValue] = useState("")
    const {connections} = adapter.useConnections()
    const [expanded, setExpanded] = useState<string | null>(null)
    const connectedKeys = useMemo(
        () => new Set(connections.map((c) => adapter.connection.integrationKey(c))),
        [connections, adapter],
    )

    const onSearch = useCallback(
        (v: string) => {
            setSearchValue(v)
            adapter.setIntegrationsSearch(v)
        },
        [adapter],
    )

    const {
        items: integrations,
        total,
        prefetchThreshold,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        requestMore,
    } = adapter.useIntegrations()

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
                        <span className="text-xs text-muted-foreground">Your connections</span>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain px-3 pb-2">
                        {connections.map((conn) => {
                            const cid =
                                adapter.connection.id(conn) ??
                                adapter.connection.slug(conn) ??
                                adapter.connection.integrationKey(conn)
                            const isOpen = expanded === cid
                            return (
                                <div
                                    key={cid}
                                    className="overflow-hidden rounded border border-solid border-[var(--ag-colorBorderSecondary)]"
                                >
                                    <button
                                        type="button"
                                        onClick={() => setExpanded(isOpen ? null : cid)}
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
                                                {adapter.connection.name(conn) ||
                                                    adapter.connection.slug(conn) ||
                                                    adapter.connection.integrationKey(conn)}
                                            </div>
                                            <div className="truncate text-[11px] text-[var(--ag-colorTextTertiary)]">
                                                {adapter.connection.integrationKey(conn)}
                                            </div>
                                        </div>
                                        {adapter.isConnectionActive(conn) && (
                                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                                        )}
                                    </button>
                                    {isOpen && (
                                        <div className="border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)]">
                                            <ConnectionItemsList
                                                connection={conn}
                                                adapter={adapter}
                                                config={config}
                                                onViewAll={() =>
                                                    onSelect(
                                                        adapter.integrationFromConnection(conn),
                                                    )
                                                }
                                            />
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    <div className="mt-auto flex shrink-0 items-start gap-1.5 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] px-4 py-3 text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                        <Lightning size={13} className="mt-[1px] shrink-0" />
                        <span>{config.connectionsHint}</span>
                    </div>
                </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex shrink-0 flex-col gap-2 px-6 pb-3 pt-4">
                    <span className="text-xs text-muted-foreground">
                        {hasConnections ? "Or connect a new app" : "Connect an app"}
                    </span>
                    <Input
                        placeholder={config.appsSearchPlaceholder}
                        prefix={<MagnifyingGlass size={16} />}
                        value={searchValue}
                        onChange={(e) => onSearch(e.target.value)}
                        allowClear
                        onClear={() => onSearch("")}
                    />
                    <span className="text-xs text-muted-foreground">
                        {total} integration{total !== 1 ? "s" : ""}
                    </span>
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
                        <div className="grid auto-rows-min gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                            {integrations.map((integration, i) => (
                                <React.Fragment key={adapter.integration.key(integration)}>
                                    {i === sentinelIndex && (
                                        <div className="col-span-full">
                                            <ScrollSentinel
                                                onVisible={requestMore}
                                                hasMore={hasNextPage}
                                                isFetching={isFetchingNextPage}
                                            />
                                        </div>
                                    )}
                                    <AppCard
                                        logo={adapter.integration.logo(integration)}
                                        name={adapter.integration.name(integration)}
                                        description={adapter.integration.description(integration)}
                                        categories={adapter.integration.categories?.(integration)}
                                        actionsCount={adapter.integration.itemCount?.(integration)}
                                        connected={connectedKeys.has(
                                            adapter.integration.key(integration),
                                        )}
                                        onClick={() => onSelect(integration)}
                                    />
                                </React.Fragment>
                            ))}

                            <div className="col-span-full">
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
                        </div>
                    )}

                    <ScrollToTopButton scrollRef={scrollRef} />
                </div>
            </div>
        </div>
    )
}

function ItemsView<I, T, C>({
    integration,
    adapter,
    config,
    onBack,
    onConnect,
}: {
    integration: I
    adapter: CatalogAdapter<I, T, C>
    config: CatalogConfig<I, T, C>
    onBack: () => void
    onConnect: () => void
}) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const [searchValue, setSearchValue] = useState("")
    const {connections} = adapter.useIntegrationConnections(adapter.integration.key(integration))

    const onSearch = useCallback(
        (v: string) => {
            setSearchValue(v)
            adapter.setItemsSearch(v)
        },
        [adapter],
    )

    // Picking an item needs a connection to bind. Prefer an active one; fall back to the first.
    const activeConn = useMemo(
        () => connections.find((c) => adapter.isConnectionActive(c)) ?? connections[0],
        [connections, adapter],
    )

    const handlePick = useCallback(
        (item: T) => {
            if (!activeConn) return
            config.onPickItem(activeConn, item, integration)
        },
        [activeConn, config, integration],
    )

    const connectionMenu = useMemo<MenuProps["items"]>(
        () =>
            config.onConnectionMenu
                ? connections.map((conn) => ({
                      key: adapter.connection.id(conn) ?? adapter.connection.slug(conn) ?? "",
                      label: (
                          <div className="flex items-center gap-2">
                              <span className="truncate">
                                  {adapter.connection.name(conn) || adapter.connection.slug(conn)}
                              </span>
                              {adapter.isConnectionActive(conn) && (
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                              )}
                          </div>
                      ),
                      onClick: () => config.onConnectionMenu?.(conn),
                  }))
                : undefined,
        [connections, adapter, config],
    )

    const {
        items,
        total,
        prefetchThreshold,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        requestMore,
    } = adapter.useItems(adapter.integration.key(integration))

    const sentinelIndex = useMemo(
        () => Math.max(0, items.length - prefetchThreshold),
        [items.length, prefetchThreshold],
    )

    const description = adapter.integration.description(integration)
    const logo = adapter.integration.logo(integration)

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <div className="flex shrink-0 flex-col gap-3 px-6 pb-3 pt-4">
                <div className="flex items-center gap-3">
                    <Button
                        type="text"
                        aria-label="Go back"
                        icon={<ArrowLeft size={16} />}
                        onClick={onBack}
                        className="shrink-0"
                    />
                    {logo && (
                        <Image
                            src={logo}
                            alt={adapter.integration.name(integration)}
                            width={32}
                            height={32}
                            className="h-8 w-8 shrink-0 rounded object-contain"
                            unoptimized
                        />
                    )}
                    <span className="flex-1 truncate font-semibold">
                        {adapter.integration.name(integration)}
                    </span>
                    <div className="shrink-0">
                        {connectionMenu && connections.length > 0 ? (
                            <Dropdown.Button
                                type="primary"
                                trigger={["click"]}
                                menu={{items: connectionMenu}}
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
                {description && <ExpandableText text={description} />}

                <Input
                    placeholder={config.itemsSearchPlaceholder}
                    prefix={<MagnifyingGlass size={16} />}
                    value={searchValue}
                    onChange={(e) => onSearch(e.target.value)}
                    allowClear
                    onClear={() => onSearch("")}
                />

                <span className="text-xs text-muted-foreground">
                    {total} item{total !== 1 ? "s" : ""}
                </span>
            </div>

            <Divider className="!m-0" />

            <div
                ref={scrollRef}
                className="relative flex-1 overflow-y-auto overscroll-contain px-6 py-3"
            >
                {isLoading && items.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                        <Spin />
                    </div>
                ) : items.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={config.emptyItemsText}
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        {items.map((item, i) => {
                            const state = config.itemTrailing?.(activeConn ?? null, item) ?? "add"
                            // A pending add or a missing connection must not fire another pick.
                            const pickDisabled = state === "pending" || !activeConn
                            const categories = adapter.item.categories?.(item)
                            const itemDescription = adapter.item.description?.(item)
                            return (
                                <React.Fragment key={adapter.item.key(item)}>
                                    {i === sentinelIndex && (
                                        <ScrollSentinel
                                            onVisible={requestMore}
                                            hasMore={hasNextPage}
                                            isFetching={isFetchingNextPage}
                                        />
                                    )}
                                    <Card
                                        className={
                                            pickDisabled
                                                ? "cursor-not-allowed"
                                                : "cursor-pointer transition-colors hover:bg-muted/30 hover:ring-foreground/20"
                                        }
                                        size="sm"
                                        onClick={pickDisabled ? undefined : () => handlePick(item)}
                                    >
                                        <CardContent>
                                            <div className="flex items-start gap-2">
                                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                    <div className="flex items-center gap-2">
                                                        <span className="truncate font-semibold">
                                                            {adapter.item.name(item) ||
                                                                adapter.item.key(item)}
                                                        </span>
                                                        {categories?.slice(0, 2).map((c) => (
                                                            <Tag key={c} className="text-xs">
                                                                {c}
                                                            </Tag>
                                                        ))}
                                                    </div>
                                                    {itemDescription && (
                                                        <span className="text-xs text-muted-foreground">
                                                            {itemDescription}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="mt-0.5">
                                                    <ItemTrailingIcon state={state} />
                                                </span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </React.Fragment>
                            )
                        })}

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

export function GatewayCatalogDrawer<I, T, C>({
    open,
    onClose,
    adapter,
    config,
}: {
    open: boolean
    onClose: () => void
    adapter: CatalogAdapter<I, T, C>
    config: CatalogConfig<I, T, C>
}) {
    const [selected, setSelected] = useState<I | null>(null)
    const [connectFor, setConnectFor] = useState<I | null>(null)

    // Reset navigation AND the shared searches when closed externally (e.g. picking an item closes
    // the drawer from the host), matching handleClose so the next open starts clean.
    useEffect(() => {
        if (!open) {
            setSelected(null)
            setConnectFor(null)
            adapter.setIntegrationsSearch("")
            adapter.setItemsSearch("")
        }
    }, [open, adapter])

    const handleClose = useCallback(() => {
        setSelected(null)
        setConnectFor(null)
        adapter.setIntegrationsSearch("")
        adapter.setItemsSearch("")
        onClose()
    }, [onClose, adapter])

    const handleBack = useCallback(() => {
        setSelected(null)
        adapter.setItemsSearch("")
    }, [adapter])

    return (
        <>
            <EnhancedDrawer
                open={open}
                onClose={handleClose}
                title={config.title(selected)}
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
                {selected ? (
                    <ItemsView
                        integration={selected}
                        adapter={adapter}
                        config={config}
                        onBack={handleBack}
                        onConnect={() => setConnectFor(selected)}
                    />
                ) : (
                    <IntegrationsView adapter={adapter} config={config} onSelect={setSelected} />
                )}
            </EnhancedDrawer>

            {connectFor &&
                config.renderConnect(connectFor, {
                    onClose: () => setConnectFor(null),
                    onSuccess: () => setConnectFor(null),
                })}
        </>
    )
}
