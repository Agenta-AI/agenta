import {projectIdAtom} from "@agenta/shared/state"
import type {AgentaApi} from "@agentaai/api-client"
import {atom} from "jotai"

import {appendSetupPreamble, type AgentSetupSelection} from "../agentSetup"
import {
    templateBuilderMessage,
    type AgentStarterTemplate,
    type TemplateConnection,
} from "../agentTemplates"
import {
    loadAgentTemplate,
    type AgentTemplateLoadRequest,
    type AgentTemplateLoadResult,
} from "../api/agentTemplates"

import {buildCreatePayloadFromEphemeral} from "./createPayload"
import {consumeWorkflowDraftAtom, invalidateWorkflowsListCache} from "./store"

export interface LoadAgentTemplateFromEphemeralParams {
    revisionId: string
    template: AgentStarterTemplate
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

const createIdempotencyKey = (): string =>
    `agent-template:${Date.now().toString(36)}:${globalThis.crypto.randomUUID()}`

const inflightLoads = new Map<string, Promise<AgentTemplateLoadResult>>()

export const loadAgentTemplateFromEphemeralAtom = atom(
    null,
    async (
        get,
        set,
        {revisionId, template, setup}: LoadAgentTemplateFromEphemeralParams,
    ): Promise<AgentTemplateLoadResult> => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("No project ID available")

        const inflightKey = `${projectId}:${revisionId}:${template.source.key}`
        const existing = inflightLoads.get(inflightKey)
        if (existing) return existing

        const pending = (async () => {
            const {data} = buildCreatePayloadFromEphemeral(get, revisionId)
            const initialMessage = setup
                ? appendSetupPreamble(templateBuilderMessage(template), setup)
                : templateBuilderMessage(template)
            const result = await loadAgentTemplate(
                {
                    source: template.source,
                    base_revision: (data ?? {}) as AgentaApi.WorkflowRevisionDataInput,
                    initial_message: initialMessage,
                    connection_choices: templateConnectionChoices(template, setup),
                },
                createIdempotencyKey(),
                projectId,
            )

            set(consumeWorkflowDraftAtom, revisionId)
            invalidateWorkflowsListCache()
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
