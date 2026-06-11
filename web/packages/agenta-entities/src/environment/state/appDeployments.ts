/**
 * App-Scoped Environment Deployment Atoms
 *
 * Derives per-app deployment info from the entity environment system.
 * Accepts appId as a parameter so consumers (OSS/EE) provide the resolved ID.
 */

import deepEqual from "fast-deep-equal"
import {atom, getDefaultStore} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomFamily} from "jotai-family"

import type {Workflow} from "../../workflow/core"
import {workflowMolecule} from "../../workflow/state/molecule"
import {workflowVariantsListDataAtomFamily} from "../../workflow/state/store"
import type {Environment, Reference} from "../core"

import type {AppDeploymentInfo} from "./store"
import {environmentsListQueryAtomFamily} from "./store"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Flat per-app deployment info for a single environment.
 * This is the shape all deployment UI components consume.
 */
export interface AppEnvironmentDeployment {
    /** Environment slug (e.g., "production") */
    slug: string
    /** Environment name (e.g., "production") */
    name: string
    /** Variant display name (app prefix stripped) */
    deployedVariantName: string | null
    /** Deployed variant entity ID */
    deployedVariantId: string | null
    /** Deployed revision entity ID */
    deployedRevisionId: string | null
    /** Deployed revision version string */
    revision: string | null
    /** Last updated timestamp */
    updatedAt: string | null
}

// ============================================================================
// HELPERS
// ============================================================================

function stripAppPrefix(
    variantSlug: string | undefined | null,
    appSlug: string | undefined | null,
): string | null {
    if (!variantSlug) return null
    if (appSlug && variantSlug.startsWith(`${appSlug}.`)) {
        return variantSlug.slice(appSlug.length + 1)
    }
    return variantSlug
}

function extractAppDeployment(env: Environment, appId: string): AppDeploymentInfo | null {
    const refs = env.data?.references
    if (!refs) return null

    for (const [appKey, entityRefs] of Object.entries(refs)) {
        const refMap = entityRefs as Record<string, Reference>
        if (refMap?.application?.id === appId) {
            return {
                appKey,
                application: refMap?.application ?? null,
                applicationVariant: refMap?.application_variant ?? null,
                applicationRevision: refMap?.application_revision ?? null,
            }
        }
    }

    return null
}

/**
 * Resolve the "last modified" date shown for a deployment.
 *
 * Prefers the deployed revision's own date, then falls back to the environment record's
 * timestamp only when no revision date is available.
 *
 * On the revision side, `created_at` is preferred over `updated_at`: a revision is an
 * immutable commit whose `created_at` is the commit/deploy moment, and the backend leaves
 * `updated_at` NULL on commit. On the fallback side, the environment's
 * `updated_at`/`created_at` track the environment artifact and do not change when a new
 * revision is deployed, so they are a misleading "last modified" and used only as a last
 * resort.
 */
export function resolveDeploymentLastModified(
    revision: Pick<Workflow, "created_at" | "updated_at"> | null | undefined,
    env: Pick<Environment, "updated_at" | "created_at">,
): string | null {
    return revision?.created_at ?? revision?.updated_at ?? env.updated_at ?? env.created_at ?? null
}

/**
 * Build the flat deployment shape for one environment.
 *
 * `revisionData` is the deployed revision's workflow entity, resolved reactively by the
 * caller (see {@link appEnvironmentsQueryAtomFamily}). It is the raw revision query data,
 * used to backfill incomplete reference data and to source the deployment's date.
 */
function toAppEnvironmentDeployment(
    env: Environment,
    appId: string,
    revisionData: Workflow | null,
): AppEnvironmentDeployment {
    const dep = extractAppDeployment(env, appId)
    const appSlug = dep?.application?.slug

    let variantName = stripAppPrefix(dep?.applicationVariant?.slug, appSlug)
    let revision = dep?.applicationRevision?.version ?? null

    // Fallback: resolve from workflow entity stores when reference data is incomplete
    // (handles deployments made before slug/version were populated in references).
    if ((!variantName || !revision) && revisionData) {
        if (!revision && revisionData.version != null) {
            revision = String(revisionData.version)
        }
        if (!variantName) {
            const variantId = dep?.applicationVariant?.id
            const workflowId = revisionData.workflow_id || appId
            const variants = workflowId
                ? getDefaultStore().get(workflowVariantsListDataAtomFamily(workflowId))
                : []
            const variantEntity = variants.find((v) => v.id === variantId)
            variantName = variantEntity?.name || variantEntity?.slug || revisionData.slug || null
        }
    }

    return {
        slug: env.slug ?? "",
        name: env.name ?? env.slug ?? "",
        deployedVariantName: variantName,
        deployedVariantId: dep?.applicationVariant?.id ?? null,
        deployedRevisionId: dep?.applicationRevision?.id ?? null,
        revision,
        // "Last modified" reflects the deployed revision's commit date, not the environment
        // record's own timestamp (see resolveDeploymentLastModified for the rationale).
        updatedAt: resolveDeploymentLastModified(revisionData, env),
    }
}

// ============================================================================
// CANONICAL DISPLAY ORDER
// ============================================================================

const ENV_ORDER: Record<string, number> = {
    development: 0,
    staging: 1,
    production: 2,
}

const EmptyEnvs: AppEnvironmentDeployment[] = []

function sortByCanonicalEnvOrder(envs: AppEnvironmentDeployment[]): AppEnvironmentDeployment[] {
    if (envs.length <= 1) return envs
    return [...envs].sort(
        (a, b) => (ENV_ORDER[a.name.toLowerCase()] ?? 99) - (ENV_ORDER[b.name.toLowerCase()] ?? 99),
    )
}

// ============================================================================
// PARAMETERIZED ATOM FAMILIES
// ============================================================================

/**
 * Query atom family for app-scoped environment deployments.
 * Pass the appId to get deployment info for that app across all environments.
 */
export const appEnvironmentsQueryAtomFamily = atomFamily((appId: string) =>
    atom((get) => {
        const listQuery = get(environmentsListQueryAtomFamily(false))

        const environments = listQuery.data?.environments ?? []
        const data = appId
            ? environments.map((env) => {
                  // Reactively resolve the deployed revision's entity so the deployment's
                  // "last modified" date (and any reference backfill) re-derives when it
                  // loads, instead of reading a stale imperative snapshot.
                  const revisionId =
                      extractAppDeployment(env, appId)?.applicationRevision?.id ?? null
                  const revisionData = revisionId
                      ? (get(workflowMolecule.atoms.query(revisionId)).data ?? null)
                      : null
                  return toAppEnvironmentDeployment(env, appId, revisionData)
              })
            : ([] as AppEnvironmentDeployment[])

        return {
            data,
            isPending: listQuery.isPending,
            isLoading: listQuery.isPending,
            isFetching: listQuery.isFetching,
            isError: listQuery.isError,
            error: listQuery.error ?? null,
            refetch: listQuery.refetch,
        }
    }),
)

/**
 * Sorted app environments for a given appId.
 * Returns environments sorted by canonical order (development → staging → production).
 */
export const appEnvironmentsAtomFamily = atomFamily((appId: string) =>
    selectAtom(
        appEnvironmentsQueryAtomFamily(appId),
        (res) => {
            const envs: AppEnvironmentDeployment[] = res?.data ?? EmptyEnvs
            return sortByCanonicalEnvOrder(envs)
        },
        deepEqual,
    ),
)

/**
 * Loadable query state for a given appId (exposes isPending, isError, refetch).
 * `data` is sorted the same as {@link appEnvironmentsAtomFamily} (development → staging → production).
 */
export const appEnvironmentsLoadableAtomFamily = atomFamily((appId: string) =>
    atom((get) => {
        const res = get(appEnvironmentsQueryAtomFamily(appId))
        return {
            ...res,
            data: sortByCanonicalEnvOrder(res.data ?? EmptyEnvs),
        }
    }),
)
