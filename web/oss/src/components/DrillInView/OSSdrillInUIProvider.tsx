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

import {appEnvironmentsQueryAtomFamily} from "@agenta/entities/environment"
import {
    buildToolSlug,
    fetchToolActionDetail,
    toolCatalogDrawerOpenAtom,
    useToolCatalogActions,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
} from "@agenta/entities/gatewayTool"
import {
    nonArchivedWorkflowsAtom,
    queryWorkflowRevisionsByWorkflow,
    resolveInputSchema as resolveWorkflowInputSchema,
    retrieveWorkflowRevision,
} from "@agenta/entities/workflow"
import {
    DrillInUIProvider,
    type GatewayToolsBridge,
    type WorkflowReferenceBridge,
    type WorkflowReferenceUI,
    type WorkflowRevisionUI,
    type WorkflowEnvironmentUI,
} from "@agenta/entity-ui/drill-in"
import {projectIdAtom} from "@agenta/shared/state"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {useLLMProviderConfig} from "@/oss/hooks/useLLMProviderConfig"
import {isToolsEnabled} from "@/oss/lib/helpers/isEE"

interface OSSdrillInUIProviderProps {
    children: ReactNode
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

// A workflow's revisions, fetched on demand when one is selected in the reference drawer (the
// variant-axis version picker). Keyed by workflow id; the project is singular in scope.
const workflowRevisionsQueryAtomFamily = atomFamily((workflowId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["agentWorkflowRevisions", workflowId, projectId],
            queryFn: () => queryWorkflowRevisionsByWorkflow(workflowId, projectId as string),
            enabled: Boolean(workflowId) && Boolean(projectId),
            staleTime: 60_000,
        }
    }),
)

function useWorkflowRevisions(workflow: WorkflowReferenceUI | null): {
    revisions: WorkflowRevisionUI[]
    isLoading: boolean
} {
    const res = useAtomValue(workflowRevisionsQueryAtomFamily(workflow?.id ?? ""))
    const revisions = useMemo<WorkflowRevisionUI[]>(() => {
        const list = (res.data?.workflow_revisions ?? []) as Record<string, unknown>[]
        return list
            .map((r) => ({
                version: r.version != null ? String(r.version) : "",
                label: typeof r.message === "string" ? (r.message as string) : undefined,
            }))
            .filter((r) => Boolean(r.version) && Number(r.version) > 0)
            .sort((a, b) => Number(b.version) - Number(a.version))
    }, [res.data])
    return {revisions, isLoading: Boolean(res.isLoading)}
}

function useWorkflowEnvironments(workflow: WorkflowReferenceUI | null): {
    environments: WorkflowEnvironmentUI[]
    isLoading: boolean
} {
    const res = useAtomValue(appEnvironmentsQueryAtomFamily(workflow?.id ?? ""))
    const environments = useMemo<WorkflowEnvironmentUI[]>(
        () =>
            (res.data ?? [])
                .filter((env) => Boolean(env.slug))
                .map((env) => ({slug: env.slug, name: env.name || env.slug})),
        [res.data],
    )
    return {environments, isLoading: Boolean(res.isLoading)}
}

/**
 * Build the "reference a workflow as a tool" bridge (#4860): the project's workflows for the
 * picker plus resolvers that pull a chosen workflow's input schema (to pre-fill `input_schema`),
 * its revisions (variant axis) and its environments (environment axis). Not EE-gated, so it ships
 * in both the tools-enabled and tools-disabled trees.
 */
function useWorkflowReferenceBridge(): WorkflowReferenceBridge {
    const projectId = useAtomValue(projectIdAtom)
    const workflows = useAtomValue(nonArchivedWorkflowsAtom)

    return useMemo<WorkflowReferenceBridge>(
        () => ({
            enabled: true,
            workflows: workflows
                .filter((w) => typeof w.slug === "string" && !w.flags?.is_evaluator)
                .map((w) => ({
                    id: w.id,
                    slug: w.slug as string,
                    name: w.name ?? undefined,
                    description: w.description ?? undefined,
                })),
            workflowsLoading: false,
            resolveInputSchema: async (workflow) => {
                if (!projectId || !workflow.slug) return null
                const revision = await retrieveWorkflowRevision({
                    projectId,
                    workflowRef: {slug: workflow.slug},
                })
                if (!revision?.data) return null
                return resolveWorkflowInputSchema(
                    revision.data as Parameters<typeof resolveWorkflowInputSchema>[0],
                )
            },
            useWorkflowRevisions,
            useWorkflowEnvironments,
        }),
        [workflows, projectId],
    )
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
    const workflowReference = useWorkflowReferenceBridge()

    if (!toolsEnabled) {
        return (
            <>
                <DrillInUIProvider
                    components={{
                        llmProviderConfig,
                        EditorProvider,
                        SharedEditor,
                        workflowReference,
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
            <GatewayToolsEnabledProvider
                llmProviderConfig={llmProviderConfig}
                workflowReference={workflowReference}
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
}: {
    children: ReactNode
    llmProviderConfig: ReturnType<typeof useLLMProviderConfig>["llmProviderConfig"]
    workflowReference: WorkflowReferenceBridge
}) {
    const {connections, isLoading} = useToolConnectionsQuery()
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
                workflowReference,
            }}
        >
            {children}
        </DrillInUIProvider>
    )
}

export default OSSdrillInUIProvider
