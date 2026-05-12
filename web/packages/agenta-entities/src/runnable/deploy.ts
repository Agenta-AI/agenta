/**
 * Publish Mutation — Entity-based deployment atom
 *
 * Publishes a revision to an environment using the new SimpleEnvironment API.
 * Resolves environment by slug/name from the list cache, then commits a
 * revision delta with full application references.
 */

import {queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"
import {atomWithMutation} from "jotai-tanstack-query"

import {deployToEnvironment} from "../environment/api/mutations"
import type {Environment} from "../environment/core"
import {invalidateEnvironmentsListCache} from "../environment/state/environmentMolecule"
import {environmentsListQueryAtomFamily} from "../environment/state/store"

// ============================================================================
// PAYLOAD TYPES
// ============================================================================

export interface PublishPayload {
    /** Workflow revision ID to deploy */
    revisionId: string
    /** Environment slug or name (e.g., "production") */
    environmentSlug: string
    /** Optional deployment note/message */
    note?: string
    /** Application (workflow) ID — required to build references */
    applicationId: string
    /** Optional: Workflow variant ID (if not provided, resolved from revision data) */
    workflowVariantId?: string
    /** Optional: Variant slug (for building appKey) */
    variantSlug?: string
    /** Optional: Application slug */
    applicationSlug?: string
    /** Optional: Revision version number */
    revisionVersion?: number | string
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Resolve environment from the list cache by slug or name.
 */
function resolveEnvironmentBySlug(
    environments: Environment[],
    slugOrName: string,
): Environment | null {
    const lower = slugOrName.toLowerCase()
    return (
        environments.find((env) => env.slug === slugOrName) ??
        environments.find((env) => env.name?.toLowerCase() === lower) ??
        null
    )
}

/**
 * Derive the appKey from environment references or construct one.
 *
 * Backend convention: keys are `{appSlug}.revision` (see EnvironmentRevisionData docs).
 * For existing deployments, reuse the current key to avoid duplicates.
 */
function resolveAppKey(env: Environment, applicationId: string, applicationSlug?: string): string {
    // Try to find existing appKey in the environment's references
    const refs = env.data?.references
    if (refs) {
        for (const [appKey, entityRefs] of Object.entries(refs)) {
            if (entityRefs?.application?.id === applicationId) {
                return appKey
            }
        }
    }

    // New deployment: use standard "{appSlug}.revision" format
    if (applicationSlug) {
        return `${applicationSlug}.revision`
    }

    return `${applicationId}.revision`
}

// ============================================================================
// PUBLISH MUTATION
// ============================================================================

/**
 * Entity-based publish mutation used by deployment UIs.
 *
 * Resolves the environment from the list cache and calls `deployToEnvironment`
 * with full application references.
 */
export const publishMutationAtom = atomWithMutation<void, PublishPayload>((get) => ({
    mutationFn: async (payload) => {
        const projectId = get(projectIdAtom)
        if (!projectId) {
            throw new Error("No project ID available for publish")
        }

        // Resolve environment from list cache
        const listQuery = get(environmentsListQueryAtomFamily(false))
        const environments = listQuery.data?.environments ?? []
        const env = resolveEnvironmentBySlug(environments, payload.environmentSlug)

        if (!env) {
            throw new Error(
                `Environment "${payload.environmentSlug}" not found. ` +
                    `Available: ${environments.map((e) => e.slug ?? e.name).join(", ")}`,
            )
        }

        if (!env.variant_id) {
            throw new Error(
                `Environment "${payload.environmentSlug}" has no variant_id. ` +
                    `Cannot commit a revision without an environment variant.`,
            )
        }

        const appKey = resolveAppKey(env, payload.applicationId, payload.applicationSlug)

        await deployToEnvironment({
            projectId,
            environmentId: env.id,
            environmentVariantId: env.variant_id,
            appKey,
            references: {
                application: {
                    id: payload.applicationId,
                    slug: payload.applicationSlug,
                },
                application_variant: {
                    id: payload.workflowVariantId || payload.applicationId,
                    slug: payload.variantSlug,
                },
                application_revision: {
                    id: payload.revisionId,
                    version:
                        payload.revisionVersion != null
                            ? String(payload.revisionVersion)
                            : undefined,
                },
            },
            message: payload.note,
        })
    },
    onSuccess: async () => {
        queryClient.invalidateQueries({queryKey: ["environments"]})
        queryClient.invalidateQueries({queryKey: ["environments-list"], exact: false})
        queryClient.invalidateQueries({queryKey: ["environment"], exact: false})
        invalidateEnvironmentsListCache()
        queryClient.invalidateQueries({queryKey: ["deploymentRevisions"]})
        queryClient.invalidateQueries({
            queryKey: ["deploymentRevision-paginated"],
            exact: false,
        })
    },
}))

/**
 * Imperative deploy helper for use outside React/atom context.
 *
 * Resolves environment from store, builds references, and calls `deployToEnvironment`.
 */
export async function publishToEnvironment(payload: PublishPayload): Promise<void> {
    const store = getDefaultStore()
    const projectId = store.get(projectIdAtom)
    if (!projectId) {
        throw new Error("No project ID available for publish")
    }

    const listQuery = store.get(environmentsListQueryAtomFamily(false))
    const environments = listQuery.data?.environments ?? []
    const env = resolveEnvironmentBySlug(environments, payload.environmentSlug)

    if (!env) {
        throw new Error(`Environment "${payload.environmentSlug}" not found.`)
    }

    if (!env.variant_id) {
        throw new Error(`Environment "${payload.environmentSlug}" has no variant_id.`)
    }

    const appKey = resolveAppKey(env, payload.applicationId, payload.applicationSlug)

    await deployToEnvironment({
        projectId,
        environmentId: env.id,
        environmentVariantId: env.variant_id,
        appKey,
        references: {
            application: {
                id: payload.applicationId,
                slug: payload.applicationSlug,
            },
            application_variant: {
                id: payload.workflowVariantId || payload.applicationId,
                slug: payload.variantSlug,
            },
            application_revision: {
                id: payload.revisionId,
                version:
                    payload.revisionVersion != null ? String(payload.revisionVersion) : undefined,
            },
        },
        message: payload.note,
    })

    // Invalidate caches
    queryClient.invalidateQueries({queryKey: ["environments"]})
    queryClient.invalidateQueries({queryKey: ["environments-list"], exact: false})
    queryClient.invalidateQueries({queryKey: ["environment"], exact: false})
    invalidateEnvironmentsListCache()
    queryClient.invalidateQueries({queryKey: ["deploymentRevisions"]})
    queryClient.invalidateQueries({queryKey: ["deploymentRevision-paginated"], exact: false})
}
