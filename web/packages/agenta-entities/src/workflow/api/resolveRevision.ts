/**
 * The revision a set of stored workflow references points to now, read the way a run reads it
 * (`retrieveWorkflowRevision`): a pinned revision, a variant's or the agent's newest revision, or
 * the revision deployed to an environment.
 *
 * An automation stores references; its next run uses the revision they point to at that moment,
 * so this is the one to check for "user" items.
 */
import {retrieveWorkflowRevision} from "./api"

/** One stored reference: an id, a slug, or a version, as the trigger stored it. */
export interface StoredRef {
    id?: string
    slug?: string
    version?: string
}

export interface WorkflowRevisionRefs {
    workflow?: StoredRef
    variant?: StoredRef
    revision?: StoredRef
    /** The environment the agent is deployed to; the run reads the revision deployed there. */
    environment?: StoredRef
    /** With an environment: the agent's entry in the deployment, `<agent slug>.revision`. */
    key?: string
}

export interface ResolvedWorkflowRevision {
    id: string
    /** The agent (workflow artifact) the revision belongs to. */
    workflowId: string | null
    /** `data.parameters` of the revision. */
    parameters: Record<string, unknown> | null
}

export async function resolveWorkflowRevisionRefs({
    projectId,
    refs,
}: {
    projectId: string
    refs: WorkflowRevisionRefs
}): Promise<ResolvedWorkflowRevision | null> {
    const revision = await retrieveWorkflowRevision({
        projectId,
        workflowRef: refs.workflow,
        workflowVariantRef: refs.variant,
        workflowRevisionRef: refs.revision,
        environmentRef: refs.environment,
        key: refs.key,
    })
    if (!revision?.id) return null
    return {
        id: revision.id,
        workflowId: revision.workflow_id ?? null,
        parameters: revision.data?.parameters ?? null,
    }
}
