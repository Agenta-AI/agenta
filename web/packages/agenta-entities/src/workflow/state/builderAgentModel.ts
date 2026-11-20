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
import type {AgentModelCandidate} from "../../secret/core"
import {commitWorkflowRevisionApi} from "../api"
import type {Workflow} from "../core"

import {applyAgentModelSelection} from "./agentCreationPrefs"

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
 * Commit `selection` as the model of the builder `revision`, with that revision as the base.
 *
 * True when the project's builder changed: this commit landed, or another one landed first (a
 * 409 conflict; its pick stands and is not retried). False when the commit was refused for
 * another reason, for example a member without edit rights: the chat then shows that a model
 * is needed, as with no candidate.
 */
export async function commitBuilderDefaultModel({
    projectId,
    revision,
    selection,
}: {
    projectId: string
    revision: Workflow
    selection: AgentModelCandidate
}): Promise<boolean> {
    if (!revision.data) return false
    const parameters = objectAt(revision.data.parameters)
    try {
        await commitWorkflowRevisionApi(projectId, {
            workflowId: revision.workflow_id ?? revision.id,
            variantId: revision.workflow_variant_id ?? undefined,
            baseRevisionId: revision.id,
            data: {
                ...revision.data,
                parameters: {
                    ...parameters,
                    agent: applyAgentModelSelection(objectAt(parameters.agent), selection),
                },
            },
        })
        return true
    } catch (error) {
        if (isConflict(error)) return true
        console.warn("[builder] The default model commit failed", error)
        return false
    }
}

const isConflict = (error: unknown): boolean =>
    (error as {response?: {status?: unknown}} | null)?.response?.status === 409
