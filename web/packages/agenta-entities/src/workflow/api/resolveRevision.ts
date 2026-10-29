/**
 * The revision a set of workflow references resolves to now: `POST /workflows/revisions/resolve`.
 *
 * An automation stores references (the agent, a variant, or a pinned revision); its next run uses
 * the revision they resolve to at that moment, so this is the one to check for "user" items.
 */
import {getWorkflowsClient} from "@agenta/sdk/resources"

export interface WorkflowRevisionRefs {
    workflowId?: string | null
    variantId?: string | null
    revisionId?: string | null
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
    // The most specific reference wins, the way the run picks it.
    const request = refs.revisionId
        ? {workflow_revision_ref: {id: refs.revisionId}}
        : refs.variantId
          ? {workflow_variant_ref: {id: refs.variantId}}
          : refs.workflowId
            ? {workflow_ref: {id: refs.workflowId}}
            : null
    if (!projectId || !request) return null
    const response = await getWorkflowsClient().resolveWorkflowRevision(
        {...request, error_policy: "keep"},
        {queryParams: {project_id: projectId}},
    )
    const revision = response.workflow_revision
    if (!revision?.id) return null
    const parameters = (revision.data as {parameters?: unknown} | null | undefined)?.parameters
    return {
        id: revision.id,
        workflowId: revision.workflow_id ?? null,
        parameters:
            parameters && typeof parameters === "object"
                ? (parameters as Record<string, unknown>)
                : null,
    }
}
