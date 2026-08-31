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
    fetchToolActionDetail,
    toolCatalogDrawerOpenAtom,
    useToolCatalogActions,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
} from "@agenta/entities/gatewayTool"
import {
    DrillInUIProvider,
    useWorkflowReferenceBridge,
    type DrillInUIComponents,
    type GatewayToolsBridge,
    type WorkflowReferenceBridge,
} from "@agenta/entity-ui/drill-in"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {isToolsEnabled} from "@agenta/shared/api"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {getDefaultStore, useSetAtom} from "jotai"

import {useLLMProviderConfig} from "@/oss/hooks/useLLMProviderConfig"
import {isDemo} from "@/oss/lib/helpers/utils"
import useURL from "@/oss/hooks/useURL"

interface OSSdrillInUIProviderProps {
    children: ReactNode
}

const openTrace = ({traceId, spanId}: {traceId: string; spanId?: string | null}) => {
    if (!traceId) return
    getDefaultStore().set(openTraceDrawerAtom, {traceId, activeSpanId: spanId})
}

function useGatewayToolsIntegrationInfo(integrationKey: string) {
    const {integration, isLoading} = useToolIntegrationDetail(integrationKey)
    return {
        name: integration?.name,
        logo: integration?.logo,
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

/**
 * OSS-specific UI provider for DrillInView components.
 *
 * Injects:
 * - llmProviderConfig: vault secrets as extra option groups + "Add provider" footer
 * - EditorProvider / SharedEditor: rich text editor components
 * - gatewayTools: gateway tools data + actions bridge for the tool selector
 * - workflowReference: workflow-as-tool reference bridge for the tool selector
 *
 * All other UI components (ChatMessage, FieldHeader, etc.) are imported
 * directly from @agenta/ui in the entities package.
 */
export function OSSdrillInUIProvider({children}: OSSdrillInUIProviderProps) {
    const {llmProviderConfig, overlay: llmProviderOverlay} = useLLMProviderConfig()
    const toolsEnabled = isToolsEnabled()
    const baseWorkflowReference = useWorkflowReferenceBridge()
    const {baseAppURL} = useURL()
    // Only the app knows its routes, so the "Open agent" link on a subagent's detail is supplied
    // here rather than guessed inside the package. Without a base URL there is no link, and the
    // detail hides the button.
    const workflowReference = useMemo(
        () => ({
            ...baseWorkflowReference,
            agentHref: (workflowId: string) =>
                baseAppURL ? `${baseAppURL}/${workflowId}/playground` : null,
        }),
        [baseWorkflowReference, baseAppURL],
    )
    // Deployment policy never changes at runtime; a stable identity keeps the context value stable.
    const deployment = useMemo(() => ({isCloud: isDemo()}), [])

    // Stable context value: every DrillInUIContext consumer re-renders when this identity changes.
    const baseComponents = useMemo(
        () =>
            ({
                llmProviderConfig,
                EditorProvider,
                SharedEditor,
                workflowReference,
                openTrace,
                deployment,
                // Rich concrete components vs the context's index-signature slots (pre-existing gap)
            }) as DrillInUIComponents,
        // openTrace is a module-level const (stable) — no dep needed.
        [llmProviderConfig, workflowReference, deployment],
    )

    if (!toolsEnabled) {
        return (
            <>
                <DrillInUIProvider components={baseComponents}>{children}</DrillInUIProvider>
                {llmProviderOverlay}
            </>
        )
    }

    return (
        <>
            <GatewayToolsEnabledProvider
                llmProviderConfig={llmProviderConfig}
                workflowReference={workflowReference}
                deployment={deployment}
            >
                {children}
            </GatewayToolsEnabledProvider>
            {llmProviderOverlay}
        </>
    )
}

function GatewayToolsEnabledProvider({
    children,
    llmProviderConfig,
    workflowReference,
    deployment,
}: {
    children: ReactNode
    llmProviderConfig: ReturnType<typeof useLLMProviderConfig>["llmProviderConfig"]
    workflowReference: WorkflowReferenceBridge
    deployment: {isCloud: boolean}
}) {
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
        [connections, isLoading, error, setCatalogDrawerOpen],
    )

    // Stable context value — see the note in OSSdrillInUIProvider.
    const components = useMemo(
        () =>
            ({
                llmProviderConfig,
                EditorProvider,
                SharedEditor,
                gatewayTools,
                workflowReference,
                openTrace,
                deployment,
                // Rich concrete components vs the context's index-signature slots (pre-existing gap)
            }) as DrillInUIComponents,
        [llmProviderConfig, gatewayTools, workflowReference, deployment],
    )

    return <DrillInUIProvider components={components}>{children}</DrillInUIProvider>
}

export default OSSdrillInUIProvider
