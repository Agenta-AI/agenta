import {workflowLatestRevisionQueryAtomFamily} from "@agenta/entities/workflow"
import {getDefaultStore, useAtomValue} from "jotai"

/**
 * Resolve a real `ag_config` + `references` payload from an app's LATEST revision, so the
 * app-scoped agent-chat page (`…/apps/[app_id]/agent-chat`) sends the actual workflow
 * config instead of a hardcoded stub.
 *
 * `appId` is the workflow artifact id (route param). `workflowLatestRevisionQueryAtomFamily`
 * resolves and fetches the app's latest revision (skipping v0); its `data.parameters` IS the
 * `ag_config`, and its id/slug/version fields give us `references` (UUID-guarded, since the
 * backend rejects local-draft ids).
 *
 * `resolveAppAgConfig` reads imperatively so the transport sends the freshest config at send
 * time; it returns `null` until the revision has loaded (caller falls back to the stub).
 * `useAgConfigStatus` is the reactive companion — it keeps the query warm while the page is
 * open and reports readiness for the header badge.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const realId = (value: unknown): string | undefined => {
    const s = typeof value === "string" ? value : undefined
    return s && UUID_RE.test(s) ? s : undefined
}

const str = (value: unknown): string | undefined =>
    typeof value === "string" && value ? value : undefined

interface RevisionLike {
    id?: string
    slug?: string
    version?: number | string | null
    workflow_id?: string
    workflow_slug?: string
    workflow_variant_id?: string
    workflow_variant_slug?: string
    artifact_id?: string
    artifact_slug?: string
    variant_id?: string
    variant_slug?: string
    data?: {parameters?: Record<string, unknown> | null} | null
}

export interface ResolvedAgentConfig {
    ag_config: Record<string, unknown>
    references: Record<string, unknown> | null
    version: number | null
}

function buildReferences(rev: RevisionLike): Record<string, unknown> | null {
    const refs: Record<string, unknown> = {}

    const appId = realId(rev.workflow_id) ?? realId(rev.artifact_id)
    const appSlug = str(rev.workflow_slug) ?? str(rev.artifact_slug)
    if (appId || appSlug) {
        refs.application = {...(appId ? {id: appId} : {}), ...(appSlug ? {slug: appSlug} : {})}
    }

    const variantId = realId(rev.workflow_variant_id) ?? realId(rev.variant_id)
    const variantSlug = str(rev.workflow_variant_slug) ?? str(rev.variant_slug)
    if (variantId || variantSlug) {
        refs.application_variant = {
            ...(variantId ? {id: variantId} : {}),
            ...(variantSlug ? {slug: variantSlug} : {}),
        }
    }

    const revId = realId(rev.id)
    const revSlug = str(rev.slug)
    const revVersion = typeof rev.version === "number" ? String(rev.version) : str(rev.version)
    if (revId || revSlug || revVersion) {
        refs.application_revision = {
            ...(revId ? {id: revId} : {}),
            ...(revSlug ? {slug: revSlug} : {}),
            ...(revVersion ? {version: revVersion} : {}),
        }
    }

    return Object.keys(refs).length > 0 ? refs : null
}

function fromRevision(rev: RevisionLike | null | undefined): ResolvedAgentConfig | null {
    const params = rev?.data?.parameters
    if (!rev || !params || Object.keys(params).length === 0) return null
    return {
        ag_config: params,
        references: buildReferences(rev),
        version: typeof rev.version === "number" ? rev.version : null,
    }
}

export function resolveAppAgConfig(appId: string | null | undefined): ResolvedAgentConfig | null {
    if (!appId) return null
    const query = getDefaultStore().get(workflowLatestRevisionQueryAtomFamily(appId))
    return fromRevision(query?.data as RevisionLike | null | undefined)
}

/** Reactive readiness for the header badge; subscribing also keeps the query warm. */
export function useAgConfigStatus(appId: string): {ready: boolean; version: number | null} {
    const query = useAtomValue(workflowLatestRevisionQueryAtomFamily(appId))
    const resolved = fromRevision(query?.data as RevisionLike | null | undefined)
    return {ready: !!resolved, version: resolved?.version ?? null}
}
