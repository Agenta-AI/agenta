import {getWorkflowsClient} from "@agenta/sdk/resources"
import {projectIdAtom} from "@agenta/shared/state"
import type {AgentaApi} from "@agentaai/api-client"
import isEqual from "fast-deep-equal"
import {atom} from "jotai"

import type {AgentSecretBinding} from "../../secret/core/types"
import {safeParseWithLogging} from "../../shared/utils/zodSchema"
import {retrieveWorkflowRevision} from "../api"
import {workflowRevisionResponseSchema, type Workflow} from "../core/schema"

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

/** The message the drawer shows when the attachments changed under it. Names the fix. */
export const AGENT_CREDENTIALS_CONFLICT_MESSAGE =
    "This agent's secret attachments changed while you were editing them. Reload the configuration and attach again."

const isRevisionConflict = (error: unknown): boolean => {
    const candidate = error as {statusCode?: number; body?: unknown} | null
    if (candidate?.statusCode !== 409) return false
    const detail = (candidate.body as {detail?: {code?: string}} | undefined)?.detail
    return detail?.code === "revision_conflict"
}

const credentialsOf = (revision: Pick<Workflow, "data">): unknown => {
    const parameters = revision.data?.parameters as Record<string, unknown> | undefined
    const agent = parameters?.agent as Record<string, unknown> | undefined
    const sandbox = agent?.sandbox as Record<string, unknown> | undefined
    return sandbox?.credentials ?? []
}

/** The revision data with only the credentials replaced. Every other field rides along. */
const withCredentials = (
    base: Pick<Workflow, "data">,
    bindings: AgentSecretBinding[],
): AgentaApi.WorkflowRevisionDataInput => {
    const parameters = base.data?.parameters as Record<string, unknown> | undefined
    const agent = parameters?.agent as Record<string, unknown> | undefined
    if (!agent) throw new Error("This revision has no agent configuration.")
    const sandbox = (agent.sandbox ?? {}) as Record<string, unknown>
    return {
        ...base.data,
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
}

// A binding commit snapshots server configuration and never consumes unrelated editor changes.
//
// The commit anchors on the variant HEAD, not on the revision the panel displays. A secret
// attachment touches only `agent.sandbox.credentials`, so building it on the head keeps every
// newer edit and never fails because the panel sat on an older revision (#6734). The displayed
// revision names the variant, gates on unsaved edits, and supplies the attachments the user
// was looking at: the callers send the full list, so a head whose attachments differ from
// the displayed ones would be overwritten. That case asks for a reload instead.
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
        const variantId = entity.workflow_variant_id
        const readHead = () =>
            retrieveWorkflowRevision({projectId, workflowVariantRef: {id: variantId}}).catch(
                () => null,
            )

        const displayedCredentials = credentialsOf(entity)
        const commitOn = async (base: Pick<Workflow, "id" | "data" | "workflow_id">) => {
            if (base.id !== revisionId && !isEqual(credentialsOf(base), displayedCredentials)) {
                // Someone attached, edited, or removed a secret since the panel loaded. The
                // caller's list would silently undo that, so the user reviews it first.
                throw new Error(AGENT_CREDENTIALS_CONFLICT_MESSAGE)
            }
            const data = withCredentials(base, bindings)
            try {
                const response = await getWorkflowsClient().commitWorkflowRevision(
                    {
                        workflow_revision: {
                            workflow_id: base.workflow_id ?? entity.workflow_id,
                            workflow_variant_id: variantId,
                            base_revision_id: base.id,
                            data,
                            message: "Update agent secret attachments",
                        },
                    },
                    {queryParams: {project_id: projectId}},
                )
                const revision = safeParseWithLogging(
                    workflowRevisionResponseSchema,
                    response,
                    "[commitAgentCredentials]",
                )?.workflow_revision
                if (!revision) {
                    throw new Error("The server did not return the saved agent revision.")
                }
                return {revision, conflict: false as const, base: base.id}
            } catch (error) {
                if (isRevisionConflict(error)) {
                    return {revision: null, conflict: true as const, base: base.id}
                }
                // A lost response may hide a successful commit. Recover only the exact intended
                // configuration; a different head must be reviewed, never silently overwritten.
                const latest = await readHead()
                if (!latest || latest.id === base.id || !isEqual(latest.data, data)) throw error
                return {revision: latest, conflict: false as const, base: base.id}
            }
        }

        // The head read can fail (offline, permission). Then the displayed revision is the best
        // base we have, and the server's conflict check still protects newer configuration.
        const head = (await readHead()) ?? entity
        let outcome = await commitOn(head)
        if (outcome.conflict) {
            // The head moved between the read and the commit: one re-read, one retry.
            const moved = await readHead()
            outcome = moved ? await commitOn(moved) : outcome
        }
        if (outcome.conflict || !outcome.revision) {
            throw new Error(AGENT_CREDENTIALS_CONFLICT_MESSAGE)
        }
        const revision = outcome.revision

        primeWorkflowRevisionDetailCacheImperative(revision)
        primeCommittedRevisionRefLists(revision)
        invalidateWorkflowRevisionsByVariantCache(variantId)
        // Edits typed during the request live on the displayed revision's draft. Carry them to
        // the adopted revision only when it was built on that same revision: copied onto a
        // newer head they would revert the head's other fields locally.
        const concurrentDraft =
            outcome.base === revisionId ? get(workflowDraftAtomFamily(revisionId)) : null
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
