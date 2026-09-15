import {Fragment, useEffect, useState, useRef} from "react"

import {
    invalidateToolConnections,
    isConnectionActive,
    isConnectionValid,
    useToolCatalogIntegrations,
    useToolConnectionsQuery,
    type ToolCatalogIntegration,
} from "@agenta/entities/gatewayTool"
import {ConnectDrawer} from "@agenta/entity-ui/gatewayTool"
import {ScrollSentinel} from "@agenta/ui"
import {Spinner} from "@agenta/ui/ui"
import {Button, Input} from "antd"
import Image from "next/image"

export default function ConnectToolsStep({
    selectedIds,
    onChange,
}: {
    selectedIds: string[]
    onChange: (ids: string[]) => void
}) {
    const catalog = useToolCatalogIntegrations()
    const {connections} = useToolConnectionsQuery()
    const [selected, setSelected] = useState<ToolCatalogIntegration | null>(null)
    const [pendingIntegration, setPendingIntegration] = useState<string | null>(null)
    const previousIds = useRef<string[]>([])
    const [search, setSearch] = useState("")
    const {setSearch: searchCatalog, setCategory} = catalog
    useEffect(() => {
        setCategory(null)
        return () => searchCatalog("")
    }, [searchCatalog, setCategory])
    useEffect(() => {
        if (!pendingIntegration) return
        const matches = connections.filter(
            (item) =>
                item.integration_key === pendingIntegration &&
                item.id &&
                !previousIds.current.includes(item.id) &&
                isConnectionActive(item) &&
                isConnectionValid(item),
        )
        if (matches.length !== 1) return
        const id = matches[0].id!
        if (!selectedIds.includes(id)) onChange([...selectedIds, id])
        setPendingIntegration(null)
    }, [pendingIntegration, connections, selectedIds, onChange])
    const scrollRef = useRef<HTMLDivElement>(null)
    const {hasNextPage, isFetchingNextPage, requestMore, prefetchThreshold} = catalog
    const activeKeys = new Set(
        connections
            .filter((item) => isConnectionActive(item) && isConnectionValid(item))
            .map((item) => item.integration_key),
    )
    const sorted = [...catalog.integrations].sort(
        (a, b) => Number(activeKeys.has(b.key)) - Number(activeKeys.has(a.key)),
    )
    const visible =
        hasNextPage && !catalog.error ? sorted.slice(0, Math.floor(sorted.length / 3) * 3) : sorted
    return (
        <div>
            <Input.Search
                aria-label="Search tools"
                placeholder="Search apps (at least 3 characters)"
                value={search}
                onChange={(event) => {
                    setSearch(event.target.value)
                    searchCatalog(event.target.value)
                }}
                className="mb-5"
            />
            {catalog.isLoading && (
                <div role="status" className="flex items-center justify-center gap-2 py-8">
                    <Spinner /> Loading apps…
                </div>
            )}
            {catalog.error && (
                <div role="alert" className="mb-4">
                    Tools couldn't load. You can continue and connect them later.{" "}
                    <Button onClick={() => void catalog.refetch()}>Retry</Button>
                </div>
            )}
            {!catalog.isLoading && !catalog.error && catalog.integrations.length === 0 && (
                <p>No apps found.</p>
            )}
            <div className="relative">
                <div ref={scrollRef} className="max-h-[360px] overflow-auto pb-8 pr-1">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                        {visible.map((integration, index) => {
                            const connection = connections.find(
                                (connection) =>
                                    connection.integration_key === integration.key &&
                                    isConnectionActive(connection) &&
                                    isConnectionValid(connection),
                            )
                            const connected = Boolean(connection)
                            const picked = Boolean(
                                connection?.id && selectedIds.includes(connection.id),
                            )
                            return (
                                <Fragment key={integration.key}>
                                    {index ===
                                        Math.max(
                                            0,
                                            Math.floor((visible.length - prefetchThreshold) / 3) *
                                                3,
                                        ) && (
                                        <div className="col-span-full h-0">
                                            <ScrollSentinel
                                                onVisible={requestMore}
                                                hasMore={hasNextPage && !catalog.error}
                                                isFetching={isFetchingNextPage}
                                                root={scrollRef.current}
                                            />
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        key={integration.key}
                                        aria-pressed={picked}
                                        onClick={() => {
                                            if (connection?.id) {
                                                onChange(
                                                    picked
                                                        ? selectedIds.filter(
                                                              (id) => id !== connection.id,
                                                          )
                                                        : [...selectedIds, connection.id],
                                                )
                                                return
                                            }
                                            previousIds.current = connections.flatMap((item) =>
                                                item.id ? [item.id] : [],
                                            )
                                            setSelected(integration)
                                        }}
                                        className="flex items-center justify-between gap-3 rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer p-4 text-left hover:bg-colorFillQuaternary aria-pressed:border-colorPrimary aria-pressed:bg-colorFillQuaternary"
                                    >
                                        <span className="flex items-center gap-2 font-medium">
                                            {integration.logo && (
                                                <Image
                                                    src={integration.logo}
                                                    alt=""
                                                    width={24}
                                                    height={24}
                                                    unoptimized
                                                />
                                            )}
                                            {integration.name}
                                        </span>
                                        <span
                                            className={`text-xs ${connected ? "text-colorSuccess" : "text-colorTextSecondary"}`}
                                        >
                                            {picked
                                                ? "Selected"
                                                : connected
                                                  ? "Connected"
                                                  : "Connect"}
                                        </span>
                                    </button>
                                </Fragment>
                            )
                        })}
                    </div>
                    <ScrollSentinel
                        onVisible={requestMore}
                        hasMore={hasNextPage && !catalog.error}
                        isFetching={isFetchingNextPage}
                        root={scrollRef.current}
                    />
                    {catalog.isFetchingNextPage && (
                        <div role="status" className="flex items-center justify-center gap-2 py-3">
                            <Spinner size="small" /> Loading more apps…
                        </div>
                    )}
                </div>
                {hasNextPage && !isFetchingNextPage && (
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-colorBgContainer to-transparent"
                    />
                )}
            </div>
            {selected && (
                <ConnectDrawer
                    open
                    useDefaultName
                    integrationKey={selected.key}
                    integrationName={selected.name}
                    integrationLogo={selected.logo ?? undefined}
                    authSchemes={selected.auth_schemes ?? []}
                    onClose={() => setSelected(null)}
                    onSuccess={() => {
                        void invalidateToolConnections()
                        setPendingIntegration(selected.key)
                        setSelected(null)
                    }}
                />
            )}
        </div>
    )
}
