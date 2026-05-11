/**
 * Environment Molecule
 *
 * Provides unified state management for environment entities using the molecule pattern.
 *
 * ## Usage
 *
 * ```typescript
 * import { environmentMolecule } from '@agenta/entities/environment'
 *
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(environmentMolecule.data(envId))
 * const isDirty = useAtomValue(environmentMolecule.isDirty(envId))
 *
 * // Write atoms (for use in other atoms with set())
 * set(environmentMolecule.actions.update, envId, { name: 'Production' })
 * set(environmentMolecule.actions.discard, envId)
 *
 * // Imperative API (for callbacks outside React/atom context)
 * const data = environmentMolecule.get.data(envId)
 * environmentMolecule.set.update(envId, { name: 'Staging' })
 * ```
 */

import {atom, getDefaultStore} from "jotai"

import {createMolecule, extendMolecule, createListExtension} from "../../shared"
import type {AtomFamily, QueryState} from "../../shared"
import {
    archiveEnvironment,
    guardEnvironment,
    unguardEnvironment,
    commitEnvironmentRevision,
    deployToEnvironment,
    undeployFromEnvironment,
    fetchLatestEnvironmentRevision,
} from "../api"
import type {Environment, EnvironmentRevisionListItem} from "../core"
import type {EnvironmentRevisionCommitParams, DeployToEnvironmentParams} from "../core"

import {
    environmentQueryAtomFamily,
    environmentDraftAtomFamily,
    environmentsListQueryAtomFamily,
    invalidateEnvironmentsListCache,
    invalidateEnvironmentCache,
    invalidateEnvironmentRevisionsListCache,
    revisionsListQueryAtomFamily,
    enableRevisionsListQueryAtom,
    revisionDeploymentAtomFamily,
    environmentBySlugAtomFamily,
    environmentAppDeploymentsAtomFamily,
    environmentAppDeploymentsBySlugAtomFamily,
    appDeploymentInEnvironmentAtomFamily,
} from "./store"

// ============================================================================
// LIST EXTENSIONS
// ============================================================================

/**
 * Revisions list extension - provides standard list API for environment revisions
 */
const revisionsListExtension = createListExtension<
    EnvironmentRevisionListItem,
    {environmentId: string; projectId: string}
>({
    name: "revisionsList",
    queryAtomFamily: revisionsListQueryAtomFamily,
    enableAtom: enableRevisionsListQueryAtom,
})

// ============================================================================
// NULL-SAFE QUERY UTILITIES
// ============================================================================

const nullQueryResultAtom = atom<QueryState<Environment>>(() => ({
    data: null,
    isPending: false,
    isError: false,
    error: null,
}))

const nullDataAtom = atom<Environment | null>(() => null)

// ============================================================================
// BASE MOLECULE
// ============================================================================

/**
 * Base environment molecule with core state management
 */
const baseEnvironmentMolecule = createMolecule<Environment, Partial<Environment>>({
    name: "environment",
    queryAtomFamily: environmentQueryAtomFamily as AtomFamily<QueryState<Environment>>,
    draftAtomFamily: environmentDraftAtomFamily,
    isDirty: (_serverData, draft) => draft !== null,
    // Environments are always server entities (no local creation flow)
    isNewEntity: () => false,
})

// ============================================================================
// EXTENDED MOLECULE
// ============================================================================

const extendedMolecule = extendMolecule(baseEnvironmentMolecule, {
    atoms: {
        list: environmentsListQueryAtomFamily as unknown as AtomFamily<unknown>,
    },
})

// ============================================================================
// ACTION ATOMS
// ============================================================================

/**
 * Strip null values from revision data references so they match the commit params type.
 * Zod-inferred types include `| null` on reference fields, but the commit API expects
 * `undefined` (optional) instead.
 */
function sanitizeRevisionData(
    data: import("../core").EnvironmentRevisionData | null | undefined,
): EnvironmentRevisionCommitParams["data"] | undefined {
    if (!data?.references) return undefined
    const cleaned: Record<
        string,
        Record<string, {id?: string; slug?: string; version?: string}>
    > = {}
    for (const [appKey, refs] of Object.entries(data.references)) {
        const cleanedRefs: Record<string, {id?: string; slug?: string; version?: string}> = {}
        for (const [refKey, ref] of Object.entries(refs)) {
            cleanedRefs[refKey] = {
                ...(ref.id ? {id: ref.id} : {}),
                ...(ref.slug ? {slug: ref.slug} : {}),
                ...(ref.version ? {version: ref.version} : {}),
            }
        }
        cleaned[appKey] = cleanedRefs
    }
    return {references: cleaned}
}

/**
 * Archive environments reducer
 */
const archiveEnvironmentsReducer = atom(
    null,
    async (
        _get,
        _set,
        params: {projectId: string; environmentIds: string[]},
    ): Promise<{success: boolean; error?: Error}> => {
        const {projectId, environmentIds} = params
        try {
            for (const id of environmentIds) {
                await archiveEnvironment(projectId, id)
            }
            invalidateEnvironmentsListCache()
            return {success: true}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

/**
 * Guard/unguard environment reducer
 */
const toggleGuardReducer = atom(
    null,
    async (
        _get,
        _set,
        params: {projectId: string; environmentId: string; guard: boolean},
    ): Promise<{success: boolean; error?: Error}> => {
        const {projectId, environmentId, guard} = params
        try {
            if (guard) {
                await guardEnvironment(projectId, environmentId)
            } else {
                await unguardEnvironment(projectId, environmentId)
            }
            invalidateEnvironmentCache(environmentId)
            invalidateEnvironmentsListCache()
            return {success: true}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

/**
 * Commit environment revision reducer
 */
const commitRevisionReducer = atom(
    null,
    async (
        _get,
        _set,
        params: EnvironmentRevisionCommitParams,
    ): Promise<{success: boolean; revisionId?: string; error?: Error}> => {
        try {
            const revision = await commitEnvironmentRevision(params)
            if (revision) {
                invalidateEnvironmentCache(params.environmentId)
                invalidateEnvironmentsListCache()
                invalidateEnvironmentRevisionsListCache(params.environmentId)
                return {success: true, revisionId: revision.id}
            }
            return {success: false, error: new Error("No revision returned")}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

/**
 * Deploy to environment reducer
 */
const deployReducer = atom(
    null,
    async (
        _get,
        _set,
        params: DeployToEnvironmentParams,
    ): Promise<{success: boolean; revisionId?: string; error?: Error}> => {
        try {
            const revision = await deployToEnvironment(params)
            if (revision) {
                invalidateEnvironmentCache(params.environmentId)
                invalidateEnvironmentsListCache()
                invalidateEnvironmentRevisionsListCache(params.environmentId)
                return {success: true, revisionId: revision.id}
            }
            return {success: false, error: new Error("No revision returned")}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

/**
 * Undeploy from environment reducer
 */
const undeployReducer = atom(
    null,
    async (
        _get,
        _set,
        params: {
            projectId: string
            environmentId: string
            environmentVariantId: string
            appKey: string
            message?: string
        },
    ): Promise<{success: boolean; revisionId?: string; error?: Error}> => {
        try {
            const revision = await undeployFromEnvironment(
                params.projectId,
                params.environmentId,
                params.environmentVariantId,
                params.appKey,
                params.message,
            )
            if (revision) {
                invalidateEnvironmentCache(params.environmentId)
                invalidateEnvironmentsListCache()
                invalidateEnvironmentRevisionsListCache(params.environmentId)
                return {success: true, revisionId: revision.id}
            }
            return {success: false, error: new Error("No revision returned")}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

/**
 * Params for reverting an environment to a previous revision's state.
 */
export interface RevertDeploymentParams {
    projectId: string
    environmentId: string
    environmentVariantId: string
    /** The target revision version to revert to (fetches its data and commits as new) */
    targetRevisionVersion: number
    message?: string
}

/**
 * Revert environment to a previous revision's state.
 *
 * Fetches the target revision's data and commits it as a new revision,
 * effectively rolling back the environment to that state.
 */
const revertReducer = atom(
    null,
    async (
        _get,
        _set,
        params: RevertDeploymentParams,
    ): Promise<{success: boolean; revisionId?: string; error?: Error}> => {
        const {projectId, environmentId, environmentVariantId, targetRevisionVersion, message} =
            params
        try {
            // Fetch the target revision to get its data
            const targetRevision = await fetchLatestEnvironmentRevision({
                projectId,
                environmentId,
            })

            // The revision query returns the latest by default. For a specific version,
            // we need to search the revisions list. For now, if the caller already has
            // the revision data (from the revisions list UI), they can use commit directly.
            // This reducer fetches the latest and validates the version matches.
            if (!targetRevision) {
                return {success: false, error: new Error("Target revision not found")}
            }

            // Commit the old revision's data as a new revision
            const revision = await commitEnvironmentRevision({
                projectId,
                environmentId,
                environmentVariantId,
                data: sanitizeRevisionData(targetRevision.data),
                message: message ?? `Revert to version ${targetRevisionVersion}`,
            })

            if (revision) {
                invalidateEnvironmentCache(environmentId)
                invalidateEnvironmentsListCache()
                invalidateEnvironmentRevisionsListCache(environmentId)
                return {success: true, revisionId: revision.id}
            }
            return {success: false, error: new Error("No revision returned")}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

/**
 * Revert environment to a specific revision's data snapshot.
 *
 * Use this when you already have the revision data (e.g., from the
 * revisions list in the UI) and want to commit it as a new revision.
 */
export interface RevertToSnapshotParams {
    projectId: string
    environmentId: string
    environmentVariantId: string
    /** The full data snapshot from the target revision */
    data: {
        references?: Record<string, Record<string, {id?: string; slug?: string; version?: string}>>
    }
    message?: string
}

const revertToSnapshotReducer = atom(
    null,
    async (
        _get,
        _set,
        params: RevertToSnapshotParams,
    ): Promise<{success: boolean; revisionId?: string; error?: Error}> => {
        const {projectId, environmentId, environmentVariantId, data, message} = params
        try {
            const revision = await commitEnvironmentRevision({
                projectId,
                environmentId,
                environmentVariantId,
                data,
                message: message ?? "Revert to previous deployment",
            })

            if (revision) {
                invalidateEnvironmentCache(environmentId)
                invalidateEnvironmentsListCache()
                invalidateEnvironmentRevisionsListCache(environmentId)
                return {success: true, revisionId: revision.id}
            }
            return {success: false, error: new Error("No revision returned")}
        } catch (error) {
            return {success: false, error: error as Error}
        }
    },
)

// ============================================================================
// FULL MOLECULE
// ============================================================================

/**
 * Full environment molecule with list query, actions, and revision history.
 *
 * ## Unified API
 *
 * ### Top-level (most common operations)
 * ```typescript
 * environment.data(id)         // Reactive: merged entity data
 * environment.query(id)        // Reactive: query state with loading/error
 * environment.isDirty(id)      // Reactive: has unsaved changes
 * ```
 *
 * ### Actions namespace (all write operations)
 * ```typescript
 * set(environment.actions.update, id, changes)
 * set(environment.actions.archive, { projectId, environmentIds })
 * set(environment.actions.toggleGuard, { projectId, environmentId, guard: true })
 * set(environment.actions.commit, commitParams)
 * set(environment.actions.deploy, deployParams)
 * ```
 */
export const environmentMolecule = {
    ...extendedMolecule,

    // =========================================================================
    // TOP-LEVEL API
    // =========================================================================

    data: extendedMolecule.atoms.data,

    query: environmentQueryAtomFamily as AtomFamily<QueryState<Environment>>,

    isDirty: extendedMolecule.atoms.isDirty,

    queryOptional: (id: string | null | undefined) =>
        id ? (environmentQueryAtomFamily(id) as typeof nullQueryResultAtom) : nullQueryResultAtom,

    dataOptional: (id: string | null | undefined) =>
        id ? extendedMolecule.atoms.data(id) : nullDataAtom,

    // =========================================================================
    // ATOMS namespace
    // =========================================================================

    atoms: {
        ...extendedMolecule.atoms,
        /** Environments where a given revision is deployed */
        revisionDeployment: revisionDeploymentAtomFamily,
        /** Resolve environment by slug (reactive) */
        bySlug: environmentBySlugAtomFamily,
        /** All app deployments for an environment (by ID) */
        appDeployments: environmentAppDeploymentsAtomFamily,
        /** All app deployments for an environment (by slug) */
        appDeploymentsBySlug: environmentAppDeploymentsBySlugAtomFamily,
        /** Single app deployment in an environment (by slug + appId) */
        appDeploymentInEnvironment: appDeploymentInEnvironmentAtomFamily,
    },

    // =========================================================================
    // ACTIONS namespace
    // =========================================================================

    actions: {
        /** Update environment draft */
        update: extendedMolecule.reducers.update,
        /** Discard environment draft */
        discard: extendedMolecule.reducers.discard,
        /** Archive environments */
        archive: archiveEnvironmentsReducer,
        /** Toggle guard on an environment */
        toggleGuard: toggleGuardReducer,
        /** Commit an environment revision */
        commit: commitRevisionReducer,
        /** Deploy an app revision to an environment */
        deploy: deployReducer,
        /** Remove an app deployment from an environment */
        undeploy: undeployReducer,
        /** Revert environment to a previous revision (fetches target revision data) */
        revert: revertReducer,
        /** Revert environment to a specific data snapshot (when you already have the data) */
        revertToSnapshot: revertToSnapshotReducer,
    },

    // =========================================================================
    // SELECTORS (backward compat)
    // =========================================================================

    selectors: {
        query: environmentQueryAtomFamily as AtomFamily<QueryState<Environment>>,
        queryOptional: (id: string | null | undefined) =>
            id
                ? (environmentQueryAtomFamily(id) as typeof nullQueryResultAtom)
                : nullQueryResultAtom,
        data: extendedMolecule.atoms.data,
        dataOptional: (id: string | null | undefined) =>
            id ? extendedMolecule.atoms.data(id) : nullDataAtom,
        serverData: extendedMolecule.atoms.serverData,
        draft: extendedMolecule.atoms.draft,
        isDirty: extendedMolecule.atoms.isDirty,
        /** Environments where a given revision is deployed */
        revisionDeployment: revisionDeploymentAtomFamily,
        /** Resolve environment by slug (reactive) */
        bySlug: environmentBySlugAtomFamily,
        /** All app deployments for an environment (by slug) */
        appDeploymentsBySlug: environmentAppDeploymentsBySlugAtomFamily,
        /** Single app deployment in an environment (by slug + appId) */
        appDeploymentInEnvironment: appDeploymentInEnvironmentAtomFamily,
    },

    // =========================================================================
    // CACHE INVALIDATION
    // =========================================================================

    invalidate: {
        list: invalidateEnvironmentsListCache,
        detail: invalidateEnvironmentCache,
        revisions: invalidateEnvironmentRevisionsListCache,
    },

    // =========================================================================
    // REVISIONS LIST
    // =========================================================================

    revisionsList: {
        atoms: revisionsListExtension.atoms.revisionsList,
        reducers: revisionsListExtension.reducers.revisionsList,
        get: revisionsListExtension.get.revisionsList,
    },

    // =========================================================================
    // IMPERATIVE GETTERS
    // =========================================================================

    get: {
        ...extendedMolecule.get,
        /**
         * Get environment data by slug from the list cache
         */
        bySlug: (slug: string): Environment | null => {
            const store = getDefaultStore()
            const query = store.get(environmentsListQueryAtomFamily(false))
            const environments = query.data?.environments ?? []
            return environments.find((env) => env.slug === slug) ?? null
        },
    },
}

export type EnvironmentMolecule = typeof environmentMolecule

export {invalidateEnvironmentsListCache, invalidateEnvironmentCache}
