import {Fragment, useEffect, useState} from "react"

import {
    isConnectionActive,
    isConnectionValid,
    useToolCatalogIntegrations,
    useToolConnectionsQuery,
} from "@agenta/entities/gatewayTool"
import {useDirectToolConnect} from "@agenta/entity-ui/gatewayTool"
import {ScrollSentinel} from "@agenta/ui"
import {Spinner} from "@agenta/ui/ui"
import {Check} from "@phosphor-icons/react"
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
    const {connect, connectingKey} = useDirectToolConnect()
    const [search, setSearch] = useState("")
    const {setSearch: searchCatalog, setCategory} = catalog
    useEffect(() => {
        setCategory(null)
        return () => searchCatalog("")
    }, [searchCatalog, setCategory])

    // Connected means in the agent: every active connection joins the first agent's
    // config, so there is no separate selection step to explain.
    const activeIds = connections
        .filter((item) => item.id && isConnectionActive(item) && isConnectionValid(item))
        .map((item) => item.id!)
        .sort()
    const activeKey = activeIds.join(",")
    useEffect(() => {
        if (activeKey !== [...selectedIds].sort().join(",")) onChange(activeIds)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeKey])

    const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
    const {hasNextPage, isFetchingNextPage, requestMore, prefetchThreshold} = catalog
    const activeKeys = new Set(
        connections
            .filter((item) => isConnectionActive(item) && isConnectionValid(item))
            .map((item) => item.integration_key),
    )
    // Cards keep their catalog position when they connect — no reshuffling underfoot.
    const items = catalog.integrations
    const visible =
        hasNextPage && !catalog.error ? items.slice(0, Math.floor(items.length / 3) * 3) : items
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
                <div ref={setScrollRoot} className="max-h-[360px] overflow-auto pb-8 pr-1">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                        {visible.map((integration, index) => {
                            const connected = activeKeys.has(integration.key)
                            const connecting = connectingKey === integration.key
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
                                                root={scrollRoot}
                                            />
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        key={integration.key}
                                        disabled={connected || connecting}
                                        onClick={() => {
                                            void connect({
                                                integrationKey: integration.key,
                                                integrationName: integration.name,
                                                authSchemes: integration.auth_schemes ?? [],
                                                existingCount: connections.filter(
                                                    (item) =>
                                                        item.integration_key === integration.key,
                                                ).length,
                                            })
                                        }}
                                        className={`flex items-center justify-between gap-3 rounded-xl border border-solid p-4 text-left ${connected ? "border-colorSuccessBorder bg-colorBgContainer" : "border-colorBorderSecondary bg-colorBgContainer hover:bg-colorFillQuaternary"}`}
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
                                        {connected ? (
                                            <span className="flex items-center gap-1 text-xs text-colorSuccess">
                                                <Check size={12} /> Connected
                                            </span>
                                        ) : connecting ? (
                                            <span className="flex items-center gap-1.5 text-xs text-colorTextSecondary">
                                                <Spinner size="small" /> Connecting…
                                            </span>
                                        ) : (
                                            <span className="text-xs text-colorTextSecondary">
                                                Connect
                                            </span>
                                        )}
                                    </button>
                                </Fragment>
                            )
                        })}
                    </div>
                    <ScrollSentinel
                        onVisible={requestMore}
                        hasMore={hasNextPage && !catalog.error}
                        isFetching={isFetchingNextPage}
                        root={scrollRoot}
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
        </div>
    )
}
