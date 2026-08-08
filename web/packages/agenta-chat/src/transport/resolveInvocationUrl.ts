/**
 * Resolve an agent's invoke endpoint from workflow references alone — ONE Fern revision fetch,
 * no molecule hydration. Pairs with `buildAgentResumeRequest` for the lite resume path.
 *
 * The URL rule mirrors `@agenta/entities` `workflow/state/runnableSetup.ts`
 * (`invocationUrlAtomFamily`): prefer the stored `data.url`, else build from the agenta
 * `data.uri` (`agenta:{kind}:{key}:{version}` → `{origin}/services/{key}/{version}`), then
 * append `/invoke`. Kept local because the state atom needs a seeded molecule store.
 */
import {retrieveWorkflowRevision} from "@agenta/entities/workflow"
import {getAgentaApiUrl} from "@agenta/shared/api"

/** `agenta:{kind}:{key}:{version}` → `{origin}/services/{key}/{version}`, or null. */
const serviceUrlFromUri = (uri: string | null | undefined): string | null => {
    if (!uri || !uri.startsWith("agenta:")) return null
    const apiUrl = getAgentaApiUrl()
    if (!apiUrl) return null
    const origin = apiUrl.replace(/\/api\/?$/, "")
    const parts = uri.replace(/^agenta:/, "").split(":")
    if (parts.length < 3) return null
    const [, ...rest] = parts
    return `${origin}/services/${rest.join("/")}`
}

/** Apply the `data.url|uri → /invoke` rule to a fetched revision. Exported for tests. */
export const invocationUrlFromRevisionData = (
    data: {url?: string | null; uri?: string | null} | null | undefined,
): string | null => {
    const serviceUrl = data?.url?.replace(/\/+$/, "") ?? serviceUrlFromUri(data?.uri)
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
