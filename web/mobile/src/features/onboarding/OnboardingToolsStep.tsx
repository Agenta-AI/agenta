import {useEffect, useMemo, useState} from "react"

import {useToolCatalogIntegrations, useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {useDirectToolConnect} from "@agenta/entity-ui/gatewayTool"
import {ScrollSentinel} from "@agenta/ui"
import {LoadError} from "@agenta/ui/components/presentational"
import {Input, Spinner} from "@agenta/ui/ui"
import {Check, MagnifyingGlass} from "@phosphor-icons/react"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {isUsableToolConnection} from "./onboardingTools"
import {OnboardingToolsSkeleton} from "./states/OnboardingToolsSkeleton"
import {useSeedToolConnections} from "./useSeedToolConnections"

/** Cards per complete row at every breakpoint (1, 2 and 3 columns). */
const ROW = 6

const copy = ONBOARDING_COPY.tools

/** Connect the apps the first agent should work in; every connected app joins it. */
export const OnboardingToolsStep = () => {
    const catalog = useToolCatalogIntegrations()
    const {connections, isLoading: connectionsLoading} = useToolConnectionsQuery()
    useSeedToolConnections(connections, connectionsLoading)
    const {connect, connectingKey} = useDirectToolConnect()
    const [search, setSearch] = useState("")
    const {setSearch: searchCatalog, setCategory} = catalog
    useEffect(() => {
        setCategory(null)
        return () => searchCatalog("")
    }, [searchCatalog, setCategory])

    const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
    const connectedKeys = useMemo(
        () =>
            new Set(connections.filter(isUsableToolConnection).map((item) => item.integration_key)),
        [connections],
    )
    const more = catalog.hasNextPage && !catalog.error
    // Intermediate pages show complete rows; cards keep their catalog position when they connect.
    const visible = more
        ? catalog.integrations.slice(0, Math.floor(catalog.integrations.length / ROW) * ROW)
        : catalog.integrations

    return (
        <div className="flex flex-col gap-5">
            <label className="relative block">
                <MagnifyingGlass
                    size={16}
                    className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                />
                <Input
                    size="lg"
                    aria-label={copy.searchLabel}
                    placeholder={copy.search}
                    value={search}
                    className="pl-9"
                    onChange={(event) => {
                        setSearch(event.target.value)
                        searchCatalog(event.target.value)
                    }}
                />
            </label>
            {catalog.error ? (
                <LoadError
                    title={copy.loadError}
                    description={copy.loadErrorHint}
                    onRetry={() => void catalog.refetch()}
                />
            ) : catalog.isLoading ? (
                <OnboardingToolsSkeleton />
            ) : catalog.integrations.length === 0 ? (
                <p className="text-muted-foreground m-0 py-6 text-center text-sm">{copy.empty}</p>
            ) : (
                <div className="relative">
                    <div
                        ref={setScrollRoot}
                        className="max-h-[min(360px,50dvh)] overflow-y-auto pb-8 pr-1"
                    >
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                            {visible.map((integration) => {
                                const connected = connectedKeys.has(integration.key)
                                const connecting = connectingKey === integration.key
                                return (
                                    <button
                                        type="button"
                                        key={integration.key}
                                        aria-disabled={connected || connecting}
                                        onClick={() => {
                                            if (connected || connecting) return
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
                                        className={cn(
                                            "bg-background text-foreground box-border flex items-center justify-between gap-3 rounded-xl border border-solid p-4 text-left",
                                            FOCUS_RING,
                                            connected
                                                ? "border-success cursor-default"
                                                : "border-border hover:bg-accent cursor-pointer",
                                        )}
                                    >
                                        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                                            {integration.logo ? (
                                                <img
                                                    src={integration.logo}
                                                    alt=""
                                                    className="size-6 shrink-0 object-contain"
                                                />
                                            ) : null}
                                            <span className="truncate">{integration.name}</span>
                                        </span>
                                        {connected ? (
                                            <span className="text-success flex shrink-0 items-center gap-1 text-xs">
                                                <Check size={12} /> {copy.connected}
                                            </span>
                                        ) : connecting ? (
                                            <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
                                                <Spinner size="small" /> {copy.connecting}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground shrink-0 text-xs">
                                                {copy.connect}
                                            </span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                        <ScrollSentinel
                            onVisible={catalog.requestMore}
                            hasMore={more}
                            isFetching={catalog.isFetchingNextPage}
                            root={scrollRoot}
                            rootMargin="0px 0px 600px 0px"
                        />
                        {catalog.isFetchingNextPage ? (
                            <div
                                role="status"
                                className="text-muted-foreground flex items-center justify-center gap-2 py-3 text-sm"
                            >
                                <Spinner size="small" /> {copy.loadingMore}
                            </div>
                        ) : null}
                    </div>
                    {more && !catalog.isFetchingNextPage ? (
                        <div
                            aria-hidden
                            className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent"
                        />
                    ) : null}
                </div>
            )}
        </div>
    )
}
