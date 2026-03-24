/**
 * Deployment Paginated Store
 *
 * Provides paginated fetching for environment revision history with IVT integration.
 * Each row represents a deploy/undeploy event for a specific environment.
 */

import {fetchEnvironmentRevisionsList} from "@agenta/entities/environment"
import type {EnvironmentRevision} from "@agenta/entities/environment"
import {createPaginatedEntityStore} from "@agenta/entities/shared"
import type {InfiniteTableFetchResult} from "@agenta/entities/shared"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import {routerAppIdAtom, currentAppAtom} from "@/oss/state/app/selectors/app"

import {selectedEnvironmentIdAtom} from "./deploymentFilterAtoms"

// Extended type that includes the appId used for the query and a per-app deployment index
interface EnvironmentRevisionWithAppContext extends EnvironmentRevision {
    __queryAppId?: string
    /** 1-based deployment index scoped to this app (1 = first deployment, N = latest) */
    __appDeploymentIndex?: number
}

// ============================================================================
// TABLE ROW TYPE
// ============================================================================

export interface DeploymentRevisionRow {
    key: string
    __isSkeleton?: boolean
    // Core IDs
    envRevisionId: string
    environmentId: string
    deployedRevisionId: string | null
    deployedRevisionVersion: number | null
    variantSlug: string | null
    variantId: string | null
    appSlug: string | null
    // Display fields
    version: number | null
    commitMessage: string | null
    createdAt: string | null
    createdById: string | null
    // Reference data for actions
    references: Record<
        string,
        Record<string, {id?: string; slug?: string; version?: string}>
    > | null
    [k: string]: unknown
}

// ============================================================================
// HELPERS
// ============================================================================

interface AppReference {
    application?: {id?: string; slug?: string}
    application_variant?: {id?: string; slug?: string}
    application_revision?: {id?: string; slug?: string; version?: string}
}

/**
 * Extract the references for a specific app from environment revision data.
 * Matches by appId first, then falls back to appSlug if provided.
 * Returns {deployedRevisionId, variantSlug, appSlug}.
 */
function extractReferencesForApp(
    data: EnvironmentRevision["data"],
    appId: string | null,
    appSlug: string | null,
): {
    deployedRevisionId: string | null
    deployedRevisionVersion: number | null
    variantSlug: string | null
    variantId: string | null
    appSlug: string | null
} {
    const empty = {
        deployedRevisionId: null,
        deployedRevisionVersion: null,
        variantSlug: null,
        variantId: null,
        appSlug: null,
    }
    if (!data?.references) return empty

    const refs = data.references as Record<string, AppReference>
    let matchedRef: AppReference | null = null

    // Find the reference matching the current app by ID or slug
    for (const [_key, ref] of Object.entries(refs)) {
        if (appId && ref?.application?.id === appId) {
            matchedRef = ref
            break
        }
        if (appSlug && ref?.application?.slug === appSlug) {
            matchedRef = ref
            break
        }
    }

    if (!matchedRef) return empty

    const versionRaw = matchedRef.application_revision?.version
    return {
        deployedRevisionId: matchedRef.application_revision?.id ?? null,
        deployedRevisionVersion: versionRaw != null ? Number(versionRaw) : null,
        variantSlug: matchedRef.application_variant?.slug ?? null,
        variantId: matchedRef.application_variant?.id ?? null,
        appSlug: matchedRef.application?.slug ?? null,
    }
}

/**
 * Get the application_revision.id for a specific app from an environment revision.
 * Used to detect whether a delta commit actually changed this app's deployment.
 */
function getAppRevisionId(
    rev: EnvironmentRevision,
    appId: string | null,
    appSlug: string | null,
): string | null {
    if (!rev.data?.references) return null
    const refs = rev.data.references as Record<string, AppReference>
    for (const ref of Object.values(refs)) {
        if (appId && ref?.application?.id === appId) {
            return ref.application_revision?.id ?? null
        }
        if (appSlug && ref?.application?.slug === appSlug) {
            return ref.application_revision?.id ?? null
        }
    }
    return null
}

// ============================================================================
// QUERY META
// ============================================================================

interface DeploymentQueryMeta {
    projectId: string | null
    environmentId: string | null
    appId: string | null
    appSlug: string | null
}

// ============================================================================
// META ATOM
// ============================================================================

const deploymentPaginatedMetaAtom = atom<DeploymentQueryMeta>((get) => {
    const appIdFromRoute = get(routerAppIdAtom)
    const currentApp = get(currentAppAtom)
    return {
        projectId: get(projectIdAtom),
        environmentId: get(selectedEnvironmentIdAtom),
        appId: appIdFromRoute || currentApp?.id || null,
        appSlug: currentApp?.name ?? currentApp?.slug ?? null,
    }
})

// ============================================================================
// PAGINATED STORE
// ============================================================================

const skeletonDefaults: Partial<DeploymentRevisionRow> = {
    envRevisionId: "",
    environmentId: "",
    deployedRevisionId: null,
    deployedRevisionVersion: null,
    variantSlug: null,
    variantId: null,
    appSlug: null,
    version: null,
    commitMessage: null,
    createdAt: null,
    createdById: null,
    references: null,
    key: "",
}

export const deploymentPaginatedStore = createPaginatedEntityStore<
    DeploymentRevisionRow,
    EnvironmentRevisionWithAppContext,
    DeploymentQueryMeta
>({
    entityName: "deploymentRevision",
    metaAtom: deploymentPaginatedMetaAtom,
    fetchPage: async ({
        meta,
    }): Promise<InfiniteTableFetchResult<EnvironmentRevisionWithAppContext>> => {
        if (!meta.projectId || !meta.environmentId || !meta.appId) {
            return {
                rows: [],
                totalCount: null,
                hasMore: false,
                nextCursor: null,
                nextOffset: null,
                nextWindowing: null,
            }
        }

        const response = await fetchEnvironmentRevisionsList({
            projectId: meta.projectId,
            environmentId: meta.environmentId,
            applicationId: meta.appId,
        })

        // Filter out v0 revisions (auto-created initial revisions) and revisions
        // that don't contain a reference for the current app (client-side safety net
        // in case the backend doesn't filter by application_refs)
        const withAppRef = response.environment_revisions
            .filter((r) => (r.version ?? 0) > 0)
            .filter((r) => {
                if (!meta.appId || !r.data?.references) return false
                const refs = r.data.references as Record<string, AppReference>
                return Object.values(refs).some(
                    (ref) =>
                        ref?.application?.id === meta.appId ||
                        (meta.appSlug && ref?.application?.slug === meta.appSlug),
                )
            })

        // Deduplicate: because environments are now project-scoped with delta commits,
        // deploying app2 creates a new env revision that carries forward app1's unchanged
        // reference. We only want to show revisions where *this app's* deployed revision
        // actually changed (i.e. a real deployment event for this app).
        // Results arrive newest-first, so we walk forward and keep rows where the
        // app_revision.id differs from the next (older) revision.
        const filtered: typeof withAppRef = []
        for (let i = 0; i < withAppRef.length; i++) {
            const current = getAppRevisionId(withAppRef[i], meta.appId, meta.appSlug)
            const older =
                i + 1 < withAppRef.length
                    ? getAppRevisionId(withAppRef[i + 1], meta.appId, meta.appSlug)
                    : null
            // Keep if this app's revision changed compared to the previous (older) env revision,
            // or if this is the oldest revision in the list (first deployment)
            if (current !== older) {
                filtered.push(withAppRef[i])
            }
        }

        // Assign per-app deployment indices (results are descending: newest first)
        // So the last item is deployment #1, first item is deployment #N
        const total = filtered.length
        const revisions: EnvironmentRevisionWithAppContext[] = filtered.map((r, i) => ({
            ...r,
            __queryAppId: meta.appId ?? undefined,
            __appDeploymentIndex: total - i,
        }))

        return {
            rows: revisions,
            totalCount: revisions.length,
            hasMore: false,
            nextCursor: null,
            nextOffset: null,
            nextWindowing: null,
        }
    },
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults,
    },
    transformRow: (apiRow): DeploymentRevisionRow => {
        // Use the appId attached during fetch to extract the correct app reference
        const queryAppId = apiRow.__queryAppId ?? null
        const {deployedRevisionId, deployedRevisionVersion, variantSlug, variantId, appSlug} =
            extractReferencesForApp(apiRow.data, queryAppId, null)

        return {
            key: apiRow.id,
            envRevisionId: apiRow.id,
            environmentId: apiRow.environment_id ?? "",
            deployedRevisionId,
            deployedRevisionVersion,
            variantSlug,
            variantId,
            appSlug,
            // Use the per-app deployment index (not the environment-level revision counter)
            version: apiRow.__appDeploymentIndex ?? apiRow.version ?? null,
            commitMessage: apiRow.message ?? null,
            createdAt: apiRow.created_at ?? null,
            createdById: apiRow.author ?? apiRow.created_by_id ?? null,
            references: (apiRow.data?.references as DeploymentRevisionRow["references"]) ?? null,
        }
    },
    isEnabled: (meta) =>
        Boolean(meta?.projectId) && Boolean(meta?.environmentId) && Boolean(meta?.appId),
    listCountsConfig: {
        totalCountMode: "total",
    },
})
