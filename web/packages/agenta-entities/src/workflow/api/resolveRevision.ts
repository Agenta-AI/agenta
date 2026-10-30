/**
 * The revision a set of workflow references resolves to now: `POST /workflows/revisions/resolve`,
 * or `POST /workflows/revisions/retrieve` for an environment binding.
 *
 * An automation stores references (the agent, a variant, a pinned revision, or an environment and
 * the agent deployed there); its next run uses the revision they resolve to at that moment, so
 * this is the one to check for "user" items.
 */
import {getWorkflowsClient} from "@agenta/sdk/resources"

export interface WorkflowRevisionRefs {
    workflowId?: string | null
    /** The agent's slug; with an environment, it names the agent's entry in the deployment. */
    workflowSlug?: string | null
    variantId?: string | null
    revisionId?: string | null
    /** The environment the agent is deployed to; the run uses the revision deployed there. */
    environment?: {id?: string | null; slug?: string | null} | null
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
    if (refs.environment?.id || refs.environment?.slug) {
        return retrieveDeployedRevision({projectId, refs})
    }
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
    return toResolvedRevision(response.workflow_revision)
}

/**
 * The revision deployed to the environment, read the way a run reads it: the environment and the
 * key `<agent slug>.revision` of the deployment's reference map.
 */
async function retrieveDeployedRevision({
    projectId,
    refs,
}: {
    projectId: string
    refs: WorkflowRevisionRefs
}): Promise<ResolvedWorkflowRevision | null> {
    if (!projectId) return null
    const ref = (value: {id?: string | null; slug?: string | null}) => ({
        ...(value.id ? {id: value.id} : {}),
        ...(value.slug ? {slug: value.slug} : {}),
    })
    const workflow = {id: refs.workflowId, slug: refs.workflowSlug}
    const response = await getWorkflowsClient().retrieveWorkflowRevision(
        {
            environment_ref: ref(refs.environment ?? {}),
            key: refs.workflowSlug ? `${refs.workflowSlug}.revision` : null,
            ...(workflow.id || workflow.slug ? {workflow_ref: ref(workflow)} : {}),
        },
        {queryParams: {project_id: projectId}},
    )
    return toResolvedRevision(response.workflow_revision)
}

const toResolvedRevision = (
    revision: {id?: string | null; workflow_id?: string | null; data?: unknown} | null | undefined,
): ResolvedWorkflowRevision | null => {
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
