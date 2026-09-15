import {useEffect, useState, useRef} from "react"

import {
    invalidateToolConnections,
    isConnectionActive,
    isConnectionValid,
    useToolCatalogIntegrations,
    useToolConnectionsQuery,
    type ToolCatalogIntegration,
} from "@agenta/entities/gatewayTool"
import {ConnectDrawer} from "@agenta/entity-ui/gatewayTool"
import {Button, Checkbox, Input, Spin} from "antd"
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
    const sentinelRef = useRef<HTMLDivElement>(null)
    const {hasNextPage, isFetchingNextPage, requestMore} = catalog
    useEffect(() => {
        if (!hasNextPage || isFetchingNextPage || catalog.error) return
        const sentinel = sentinelRef.current
        if (!sentinel) return
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    requestMore()
                    observer.disconnect()
                }
            },
            {root: scrollRef.current, rootMargin: "120px"},
        )
        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [hasNextPage, isFetchingNextPage, requestMore, catalog.integrations.length, catalog.error])
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
            <p className="text-colorTextSecondary">
                Select the connected apps this agent can use. Selected apps allow all actions; you
                can edit permissions after creation.
            </p>
            <div className="mb-5 flex flex-col gap-3">
                {connections
                    .filter(
                        (item) =>
                            item.id &&
                            item.slug &&
                            ((isConnectionActive(item) && isConnectionValid(item)) ||
                                selectedIds.includes(item.id)),
                    )
                    .map((connection) => (
                        <Checkbox
                            key={connection.id}
                            checked={selectedIds.includes(connection.id!)}
                            onChange={(event) =>
                                onChange(
                                    event.target.checked
                                        ? [
                                              ...selectedIds.filter((id) => {
                                                  const other = connections.find(
                                                      (item) => item.id === id,
                                                  )
                                                  return (
                                                      other?.provider_key !==
                                                          connection.provider_key ||
                                                      other?.integration_key !==
                                                          connection.integration_key
                                                  )
                                              }),
                                              connection.id!,
                                          ]
                                        : selectedIds.filter((id) => id !== connection.id),
                                )
                            }
                        >
                            {connection.name || connection.integration_key || "Connected app"}
                        </Checkbox>
                    ))}
            </div>
            {selectedIds.length > 0 && (
                <Button className="mb-4" onClick={() => onChange([])}>
                    Clear selected apps
                </Button>
            )}
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
            {catalog.isLoading && <Spin aria-label="Loading tools" />}
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
                        {visible.map((integration) => {
                            const connected = connections.some(
                                (connection) =>
                                    connection.integration_key === integration.key &&
                                    isConnectionActive(connection) &&
                                    isConnectionValid(connection),
                            )
                            return (
                                <button
                                    type="button"
                                    key={integration.key}
                                    disabled={connected}
                                    onClick={() => {
                                        previousIds.current = connections.flatMap((item) =>
                                            item.id ? [item.id] : [],
                                        )
                                        setSelected(integration)
                                    }}
                                    className="flex items-center justify-between gap-3 rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer p-4 text-left hover:bg-colorFillQuaternary disabled:cursor-default"
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
                                        {connected ? "Connected" : "Connect"}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                    <div ref={sentinelRef} className="h-2" aria-hidden="true" />
                    {catalog.isFetchingNextPage && (
                        <div role="status" className="py-3 text-center">
                            <Spin size="small" /> Loading more apps…
                        </div>
                    )}
                </div>
                {hasNextPage && (
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
