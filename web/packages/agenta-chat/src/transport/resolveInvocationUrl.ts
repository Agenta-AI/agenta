/**
 * Resolve an agent's invoke endpoint from workflow references alone — ONE Fern revision fetch,
 * no molecule hydration. Pairs with `buildAgentResumeRequest` for the lite resume path.
 *
 * The URL rule is `@agenta/entities`' `resolveServiceUrl` — the SAME function the playground's
 * `invocationUrlAtomFamily` calls, not a copy of it. It used to be a copy, and the copy drifted:
 * both preferred a stored `data.url` whose origin is stamped at creation, so a deployment that
 * moved its public URL sent every invoke to a host that no longer served it.
 */
import {resolveServiceUrl, retrieveWorkflowRevision} from "@agenta/entities/workflow"

/** Apply the `data.url|uri → /invoke` rule to a fetched revision. Exported for tests. */
export const invocationUrlFromRevisionData = (
    data: {url?: string | null; uri?: string | null} | null | undefined,
): string | null => {
    const serviceUrl = resolveServiceUrl(data)
    return serviceUrl ? `${serviceUrl}/invoke` : null
}

export interface ResolveInvocationUrlArgs {
    projectId: string
    /** The exact revision that ran (`workflow_revision`/`application_revision` ref id). */
    revisionId?: string | null
    /** Fallback identity: the workflow artifact id — resolves to its latest revision. */
    workflowId?: string | null
}

/**
 * Fetch the revision by reference (revision id preferred, workflow id fallback — one call
 * carries both) and derive its `/invoke` URL. Returns `null` when nothing resolves.
 */
export async function resolveInvocationUrl({
    projectId,
    revisionId,
    workflowId,
}: ResolveInvocationUrlArgs): Promise<string | null> {
    if (!projectId || (!revisionId && !workflowId)) return null
    const revision = await retrieveWorkflowRevision({
        projectId,
        workflowRef: workflowId ? {id: workflowId} : undefined,
        workflowRevisionRef: revisionId ? {id: revisionId} : undefined,
    })
    return invocationUrlFromRevisionData(revision?.data ?? null)
}
