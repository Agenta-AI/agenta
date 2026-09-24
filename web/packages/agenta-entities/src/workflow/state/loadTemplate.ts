import {projectIdAtom} from "@agenta/shared/state"
import type {AgentaApi} from "@agentaai/api-client"
import {atom} from "jotai"

import {type AgentSetupSelection} from "../agentSetup"
import {
    templateBuilderMessage,
    type AgentStarterTemplate,
    type TemplateConnection,
} from "../agentTemplates"
import {fetchAgentBuildKitOverlay} from "../api"
import {
    loadAgentTemplate,
    type AgentTemplateLoadRequest,
    type AgentTemplateLoadResult,
} from "../api/agentTemplates"
import {resolveBuildKitPermissions, type BuildKitUiState} from "../buildKitPolicy"

import {buildCreatePayloadFromEphemeral} from "./createPayload"
import {
    consumeWorkflowDraftAtom,
    invalidateWorkflowsListCache,
    workflowBuildKitUiStateAtomFamily,
    workflowAgentTemplateOverlayAtomFamily,
    transferBuildKitStateAtom,
} from "./store"

export interface LoadAgentTemplateFromEphemeralParams {
    revisionId: string
    template: AgentStarterTemplate
    /** Preserve the host's editable template prompt when it differs from the card default. */
    stagingSessionId?: string
    attachmentIds?: string[]
    initialMessage?: string
    setup?: AgentSetupSelection
}

type ConnectionChoice = NonNullable<AgentTemplateLoadRequest["connection_choices"]>[number]

const selectedConnectionChoice = (
    connection: TemplateConnection,
    connected: Set<string>,
): ConnectionChoice => {
    const integration = [connection.primary.slug, ...(connection.alternatives ?? [])].find((slug) =>
        connected.has(slug),
    )
    if (integration) {
        return {
            connection_key: connection.key,
            kind: "gateway",
            provider: "composio",
            integration,
        }
    }
    return {connection_key: connection.key, kind: "skip"}
}

export const templateConnectionChoices = (
    template: AgentStarterTemplate,
    setup?: AgentSetupSelection,
): ConnectionChoice[] => {
    const connected = new Set(setup?.connectedSlugs ?? [])
    return template.connections.map((connection) => selectedConnectionChoice(connection, connected))
}

interface LoadIntent {
    buildKitState?: BuildKitUiState
    key: string
    request: Omit<AgentTemplateLoadRequest, "project_id">
}
const intents = new Map<string, LoadIntent>()

const readIntent = (scope: string): LoadIntent | undefined => {
    if (intents.has(scope)) return intents.get(scope)
    try {
        const stored = globalThis.sessionStorage?.getItem(scope)
        if (stored) return JSON.parse(stored) as LoadIntent
    } catch {
        /* Storage may be unavailable. The in-memory intent still survives retries. */
    }
    return undefined
}

const saveIntent = (scope: string, intent: LoadIntent | null) => {
    if (intent) intents.set(scope, intent)
    else intents.delete(scope)
    try {
        if (intent) globalThis.sessionStorage?.setItem(scope, JSON.stringify(intent))
        else globalThis.sessionStorage?.removeItem(scope)
    } catch {
        /* Private browsing may reject storage writes. */
    }
}

export const abandonAgentTemplateLoad = (projectId: string, templateKey: string) => {
    saveIntent(`agent-template-intent:${projectId}:${templateKey}`, null)
}

const inflightLoads = new Map<string, Promise<AgentTemplateLoadResult>>()

export const loadAgentTemplateFromEphemeralAtom = atom(
    null,
    async (
        get,
        set,
        {
            revisionId,
            template,
            initialMessage,
            setup,
            stagingSessionId,
            attachmentIds,
        }: LoadAgentTemplateFromEphemeralParams,
    ): Promise<AgentTemplateLoadResult> => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("No project ID available")

        const inflightKey = `${projectId}:${revisionId}:${template.source.key}`
        const existing = inflightLoads.get(inflightKey)
        if (existing) return existing

        const pending = (async () => {
            const {data} = buildCreatePayloadFromEphemeral(get, revisionId)
            const buildKitState = get(workflowBuildKitUiStateAtomFamily(revisionId))
            const overlay =
                get(workflowAgentTemplateOverlayAtomFamily(revisionId)) ??
                (buildKitState.enabled ? await fetchAgentBuildKitOverlay(projectId) : null)
            if (buildKitState.enabled && !overlay)
                throw new Error(
                    "The build kit is still loading. Try again before starting the template.",
                )
            const seedMessage = initialMessage?.trim() || templateBuilderMessage(template)
            const intentScope = `agent-template-intent:${projectId}:${template.source.key}`
            const intent = readIntent(intentScope) ?? {
                key: `agent-template:${revisionId}:${template.source.key}`,
                buildKitState,
                request: {
                    source: template.source,
                    base_revision: (data ?? {}) as AgentaApi.WorkflowRevisionDataInput,
                    initial_message: seedMessage,
                    staging_session_id: stagingSessionId,
                    attachment_ids: attachmentIds,
                    ui_build_kit_enabled: buildKitState.enabled,
                    ui_disabled_ops: buildKitState.disabledOps,
                    ui_op_permissions: resolveBuildKitPermissions(overlay, buildKitState),
                    connection_choices: templateConnectionChoices(template, setup),
                },
            }
            saveIntent(intentScope, intent)
            const result = await loadAgentTemplate(intent.request, intent.key, projectId)

            set(transferBuildKitStateAtom, {
                revisionId,
                workflowId: result.workflow_id,
                state: intent.buildKitState ?? {
                    enabled: intent.request.ui_build_kit_enabled ?? false,
                    disabledOps: intent.request.ui_disabled_ops ?? [],
                    permissionOverrides: intent.request.ui_op_permissions ?? {},
                },
            })
            set(consumeWorkflowDraftAtom, revisionId)
            invalidateWorkflowsListCache()
            saveIntent(intentScope, null)
            return result
        })()

        inflightLoads.set(inflightKey, pending)
        try {
            return await pending
        } finally {
            if (inflightLoads.get(inflightKey) === pending) inflightLoads.delete(inflightKey)
        }
    },
)
