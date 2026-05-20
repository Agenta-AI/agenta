/**
 * OSSdrillInUIProvider
 *
 * Provides OSS-specific UI components to the DrillInView package components
 * via the DrillInUIProvider context.
 *
 * Most UI components (Editor, ChatMessage, FieldHeader, etc.) are now imported
 * directly from @agenta/ui in the entities package. This provider only needs
 * to inject truly app-specific components that have OSS-level integrations.
 *
 * @example
 * ```tsx
 * // Wrap your app or feature root with this provider
 * function App() {
 *   return (
 *     <OSSdrillInUIProvider>
 *       <YourContent />
 *     </OSSdrillInUIProvider>
 *   )
 * }
 * ```
 */

import {useMemo, type ReactNode} from "react"

import {
    buildToolSlug,
    catalogDrawerOpenAtom,
    fetchActionDetail as fetchToolActionDetail,
    useCatalogActions,
    useConnectionsQuery,
    useIntegrationDetail,
} from "@agenta/entities/gatewayTool"
import {DrillInUIProvider, type GatewayToolsBridge} from "@agenta/entity-ui/drill-in"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {useSetAtom} from "jotai"

import {useLLMProviderConfig} from "@/oss/hooks/useLLMProviderConfig"
import {isToolsEnabled} from "@/oss/lib/helpers/isEE"

interface OSSdrillInUIProviderProps {
    children: ReactNode
}

function useGatewayToolsIntegrationInfo(integrationKey: string) {
    const {integration, isLoading} = useIntegrationDetail(integrationKey)
    return {
        name: integration?.name,
        logo: integration?.logo,
        isLoading,
    }
}

function useGatewayToolsCatalogActions(integrationKey: string) {
    const res = useCatalogActions(integrationKey)
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

/**
 * OSS-specific UI provider for DrillInView components.
 *
 * Injects:
 * - llmProviderConfig: vault secrets as extra option groups + "Add provider" footer
 * - EditorProvider / SharedEditor: rich text editor components
 * - gatewayTools: gateway tools data + actions bridge for the tool selector
 *
 * All other UI components (ChatMessage, FieldHeader, etc.) are imported
 * directly from @agenta/ui in the entities package.
 */
export function OSSdrillInUIProvider({children}: OSSdrillInUIProviderProps) {
    const {llmProviderConfig, overlay: llmProviderOverlay} = useLLMProviderConfig()
    const toolsEnabled = isToolsEnabled()

    if (!toolsEnabled) {
        return (
            <>
                <DrillInUIProvider
                    components={{
                        llmProviderConfig,
                        EditorProvider,
                        SharedEditor,
                    }}
                >
                    {children}
                </DrillInUIProvider>
                {llmProviderOverlay}
            </>
        )
    }

    return (
        <>
            <GatewayToolsEnabledProvider llmProviderConfig={llmProviderConfig}>
                {children}
            </GatewayToolsEnabledProvider>
            {llmProviderOverlay}
        </>
    )
}

function GatewayToolsEnabledProvider({
    children,
    llmProviderConfig,
}: {
    children: ReactNode
    llmProviderConfig: ReturnType<typeof useLLMProviderConfig>["llmProviderConfig"]
}) {
    const {connections, isLoading} = useConnectionsQuery()
    const setCatalogDrawerOpen = useSetAtom(catalogDrawerOpenAtom)

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
            onOpenCatalog: () => setCatalogDrawerOpen(true),
            useIntegrationInfo: (integrationKey: string) => {
                const info = useGatewayToolsIntegrationInfo(integrationKey)
                return {
                    name: info.name,
                    logo: info.logo ?? undefined,
                    isLoading: info.isLoading,
                }
            },
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
        [connections, isLoading, setCatalogDrawerOpen],
    )

    return (
        <DrillInUIProvider
            components={{
                llmProviderConfig,
                EditorProvider,
                SharedEditor,
                gatewayTools,
            }}
        >
            {children}
        </DrillInUIProvider>
    )
}

export default OSSdrillInUIProvider
