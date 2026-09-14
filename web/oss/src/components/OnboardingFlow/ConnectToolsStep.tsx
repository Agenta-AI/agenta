import {useEffect, useState} from "react"

import {
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
                isConnectionActive(item) &&
                isConnectionValid(item),
        )
        if (matches.length !== 1) return
        const id = matches[0].id!
        if (!selectedIds.includes(id)) onChange([...selectedIds, id])
        setPendingIntegration(null)
    }, [pendingIntegration, connections, selectedIds, onChange])
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
            <div className="grid max-h-[360px] grid-cols-1 gap-3 overflow-auto pr-1 sm:grid-cols-2 md:grid-cols-3">
                {catalog.integrations.map((integration) => {
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
                            onClick={() => setSelected(integration)}
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
            {catalog.hasNextPage && (
                <Button
                    className="mt-4"
                    loading={catalog.isFetchingNextPage}
                    onClick={catalog.requestMore}
                >
                    Show more apps
                </Button>
            )}
            {selected && (
                <ConnectDrawer
                    open
                    integrationKey={selected.key}
                    integrationName={selected.name}
                    integrationLogo={selected.logo ?? undefined}
                    authSchemes={selected.auth_schemes ?? []}
                    onClose={() => setSelected(null)}
                    onSuccess={() => {
                        setPendingIntegration(selected.key)
                        setSelected(null)
                    }}
                />
            )}
        </div>
    )
}
