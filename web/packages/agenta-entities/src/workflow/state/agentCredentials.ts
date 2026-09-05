import {getWorkflowsClient} from "@agenta/sdk/resources"
import {projectIdAtom} from "@agenta/shared/state"
import type {AgentaApi} from "@agentaai/api-client"
import isEqual from "fast-deep-equal"
import {atom} from "jotai"

import type {AgentSecretBinding} from "../../secret/core/types"
import {retrieveWorkflowRevision} from "../api"
import {workflowRevisionResponseSchema} from "../core/schema"

import {invokeWorkflowCommitCallbacks} from "./commit"
import {
    workflowEntityAtomFamily,
    workflowDraftAtomFamily,
    workflowIsDirtyAtomFamily,
    updateWorkflowDraftAtom,
    primeWorkflowRevisionDetailCacheImperative,
    primeCommittedRevisionRefLists,
    invalidateWorkflowRevisionsByVariantCache,
} from "./store"

// A binding commit snapshots server configuration and never consumes unrelated editor changes.
export const commitAgentCredentialsAtom = atom(
    null,
    async (
        get,
        set,
        {revisionId, bindings}: {revisionId: string; bindings: AgentSecretBinding[]},
    ) => {
        const projectId = get(projectIdAtom)
        const entity = get(workflowEntityAtomFamily(revisionId))
        if (!projectId || !entity?.data || !entity.workflow_variant_id) {
            throw new Error("Save this agent before attaching a secret.")
        }
        if (get(workflowIsDirtyAtomFamily(revisionId))) {
            throw new Error("Save or discard your configuration changes before attaching a secret.")
        }
        const parameters = entity.data.parameters as Record<string, unknown> | undefined
        const agent = parameters?.agent as Record<string, unknown> | undefined
        if (!agent) throw new Error("This revision has no agent configuration.")
        const sandbox = (agent.sandbox ?? {}) as Record<string, unknown>
        const data = {
            ...entity.data,
            parameters: {
                ...parameters,
                agent: {
                    ...agent,
                    sandbox: {
                        ...sandbox,
                        credentials: bindings.map(({secret, binding}) => ({
                            secret: {slug: secret.slug},
                            binding: {type: binding.type, name: binding.name},
                        })),
                    },
                },
            },
        } as AgentaApi.WorkflowRevisionDataInput
        let revision
        try {
            const response = await getWorkflowsClient().commitWorkflowRevision(
                {
                    workflow_revision: {
                        workflow_id: entity.workflow_id,
                        workflow_variant_id: entity.workflow_variant_id,
                        base_revision_id: revisionId,
                        data,
                        message: "Update agent secret attachments",
                    },
                },
                {queryParams: {project_id: projectId}},
            )
            revision = workflowRevisionResponseSchema.parse(response).workflow_revision
            if (!revision) throw new Error("The server did not return the saved agent revision.")
        } catch (error) {
            // A lost response may hide a successful commit. Recover only the exact intended
            // configuration; a different head must be reviewed, never silently overwritten.
            const latest = await retrieveWorkflowRevision({
                projectId,
                workflowVariantRef: {id: entity.workflow_variant_id},
            }).catch(() => null)
            if (!latest || latest.id === revisionId || !isEqual(latest.data, data)) throw error
            revision = latest
        }
        primeWorkflowRevisionDetailCacheImperative(revision)
        primeCommittedRevisionRefLists(revision)
        invalidateWorkflowRevisionsByVariantCache(entity.workflow_variant_id)
        const concurrentDraft = get(workflowDraftAtomFamily(revisionId))
        if (concurrentDraft) {
            // Preserve edits typed while the binding request was in flight on the adopted revision.
            const draftParameters = concurrentDraft.data?.parameters as
                | Record<string, unknown>
                | undefined
            const draftAgent = draftParameters?.agent as Record<string, unknown> | undefined
            set(updateWorkflowDraftAtom, revision.id, {
                ...concurrentDraft,
                data: {
                    ...concurrentDraft.data,
                    parameters: {
                        ...draftParameters,
                        agent: {
                            ...draftAgent,
                            sandbox: {
                                ...((draftAgent?.sandbox as Record<string, unknown>) ?? {}),
                                credentials: bindings,
                            },
                        },
                    },
                },
            })
        }
        await invokeWorkflowCommitCallbacks(
            {success: true, revisionId, newRevisionId: revision.id, workflow: revision},
            {revisionId},
        ).catch(() => undefined)
        return {revisionId: revision.id}
    },
)
