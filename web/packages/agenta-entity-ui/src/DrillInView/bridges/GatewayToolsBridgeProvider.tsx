/**
 * GatewayToolsBridgeProvider
 *
 * Adds the gateway-tools bridge to the drill-in context, re-providing whatever the surrounding
 * DrillInUIProvider already supplied. Every host needs the identical wiring — it is entirely
 * `@agenta/entities/gatewayTool` — so it lives here rather than being rebuilt per app.
 *
 * Mount it INSIDE a DrillInUIProvider:
 *   <DrillInUIProvider components={...}><GatewayToolsBridgeProvider>…</GatewayToolsBridgeProvider></DrillInUIProvider>
 *
 * When tools are off it renders children untouched, so the connections query never runs.
 */
import {useMemo, type PropsWithChildren} from "react"

import {
    buildToolSlug,
    fetchToolActionDetail,
    toolCatalogDrawerOpenAtom,
    useToolCatalogActions,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
} from "@agenta/entities/gatewayTool"
import {isToolsEnabled} from "@agenta/shared/api"
import {
    DrillInUIProvider,
    useDrillInUI,
    type DrillInUIComponents,
    type GatewayToolsBridge,
} from "@agenta/ui/drill-in"
import {useSetAtom} from "jotai"

function useGatewayToolsIntegrationInfo(integrationKey: string) {
    const {integration, isLoading} = useToolIntegrationDetail(integrationKey)
    return {
        name: integration?.name,
        logo: integration?.logo ?? undefined,
        isLoading,
    }
}

function useGatewayToolsCatalogActions(integrationKey: string) {
    const res = useToolCatalogActions(integrationKey)
    return {
        actions: res.actions.map((action) => ({key: action.key, name: action.name})),
        total: res.total,
        isLoading: res.isLoading,
        isFetchingNextPage: res.isFetchingNextPage,
        hasNextPage: res.hasNextPage,
        requestMore: res.requestMore,
        setSearch: res.setSearch,
        prefetchThreshold: res.prefetchThreshold,
    }
}

function GatewayToolsEnabled({children}: PropsWithChildren) {
    const parent = useDrillInUI()
    const {connections, isLoading, error} = useToolConnectionsQuery()
    const setCatalogDrawerOpen = useSetAtom(toolCatalogDrawerOpenAtom)

    const gatewayTools = useMemo<GatewayToolsBridge>(
        () => ({
            enabled: true,
            connections: connections
                .filter((c) => typeof c.id === "string" && typeof c.slug === "string")
                .map((connection) => ({
                    id: connection.id as string,
                    slug: connection.slug as string,
                    name: connection.name ?? undefined,
                    integration_key: connection.integration_key,
                    provider_key: connection.provider_key,
                    flags: (connection.flags ?? undefined) as Record<string, unknown> | undefined,
                })),
            connectionsLoading: isLoading,
            connectionsErrored: !!error,
            onOpenCatalog: () => setCatalogDrawerOpen(true),
            useIntegrationInfo: useGatewayToolsIntegrationInfo,
            useActions: useGatewayToolsCatalogActions,
            buildToolSlug,
            fetchActionDetail: async (provider: string, integration: string, action: string) => {
                const detail = await fetchToolActionDetail(provider, integration, action)
                const detailedAction =
                    detail.action && "schemas" in detail.action ? detail.action : null
                return {
                    action: {
                        description: detailedAction?.description ?? undefined,
                        schemas: detailedAction?.schemas
                            ? {inputs: detailedAction.schemas.inputs}
                            : undefined,
                    },
                }
            },
        }),
        [connections, isLoading, error, setCatalogDrawerOpen],
    )

    // Stable context value: every DrillInUIContext consumer re-renders when this identity changes.
    const components = useMemo<DrillInUIComponents>(
        () => ({...parent, gatewayTools}),
        [parent, gatewayTools],
    )

    return <DrillInUIProvider components={components}>{children}</DrillInUIProvider>
}

export function GatewayToolsBridgeProvider({children}: PropsWithChildren) {
    if (!isToolsEnabled()) return <>{children}</>
    return <GatewayToolsEnabled>{children}</GatewayToolsEnabled>
}
