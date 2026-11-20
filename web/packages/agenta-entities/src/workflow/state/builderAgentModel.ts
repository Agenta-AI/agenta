/**
 * The builder's model in a project.
 *
 * The builder ships with no model: a project commits its own (`parameters.agent.llm`, an
 * editable field of the builder's catalog entry). When the builder revision a project reads has
 * no model, the web app picks one with the rule a new agent uses (an explicit pick, the last
 * remembered pick, the first Agenta built-in model, the first project connection; never an
 * organization connection) and commits it as the project's first builder revision. With no
 * candidate it commits nothing, and the chat shows that a model is needed.
 */
import {getDefaultStore} from "jotai"

import {resolveAgentModelSelection} from "../../secret/core"
import {subscriptionPairModelsAtom} from "../../secret/state"
import {commitWorkflowRevisionApi, retrieveWorkflowRevision} from "../api"
import type {Workflow} from "../core"

import {
    agentCreationPrefsAtom,
    applyAgentModelSelection,
    selectionFromAgentCreationPrefs,
} from "./agentCreationPrefs"
import {loadAgentModelCandidates} from "./agentModelCandidates"

const objectAt = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}

/** Whether the revision names a model. */
export const builderRevisionHasModel = (revision: Workflow): boolean => {
    const agent = objectAt(objectAt(revision.data?.parameters).agent)
    return typeof objectAt(agent.llm).model === "string"
}

/**
 * The builder revision to use: `revision` itself when it has a model or no candidate exists,
 * the committed revision after a default commit, or the project's current revision when the
 * commit lost to another one (someone else opened the builder first, so their pick stands).
 */
export async function ensureBuilderAgentModel({
    projectId,
    userId,
    revision,
}: {
    projectId: string
    userId: string
    revision: Workflow
}): Promise<Workflow> {
    if (builderRevisionHasModel(revision)) return revision

    const store = getDefaultStore()
    const candidateState = await loadAgentModelCandidates({
        projectId,
        userId,
        pairModelSelection: store.get(subscriptionPairModelsAtom),
    })
    if (candidateState.status !== "ready") return revision
    const selected = resolveAgentModelSelection({
        candidates: candidateState.candidates,
        last: selectionFromAgentCreationPrefs(store.get(agentCreationPrefsAtom)),
    })
    if (!selected || !revision.data) return revision

    const parameters = objectAt(revision.data.parameters)
    const workflowId = revision.workflow_id ?? revision.id
    try {
        return await commitWorkflowRevisionApi(projectId, {
            workflowId,
            variantId: revision.workflow_variant_id ?? undefined,
            baseRevisionId: revision.id,
            data: {
                ...revision.data,
                parameters: {
                    ...parameters,
                    agent: applyAgentModelSelection(objectAt(parameters.agent), selected),
                },
            },
        })
    } catch {
        // A conflict: another commit landed first. Read it and do not commit again.
        return (
            (await retrieveWorkflowRevision({
                projectId,
                workflowRef: {id: workflowId},
            }).catch(() => null)) ?? revision
        )
    }
}
