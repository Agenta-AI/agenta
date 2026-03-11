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
