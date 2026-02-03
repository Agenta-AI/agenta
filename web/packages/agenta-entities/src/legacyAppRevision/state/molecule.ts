/**
 * LegacyAppRevision Molecule
 *
 * Unified API for OSS app revision entity state management.
 * Uses the molecule pattern for consistency with other entities.
 *
 * This molecule uses the legacy backend API (AppVariantRevision model)
 * instead of the new /variants/configs endpoint.
 *
 * @example
 * ```typescript
 * import { ossAppRevisionMolecule } from '@agenta/entities/legacyAppRevision'
 *
 * // Selectors
 * const data = useAtomValue(ossAppRevisionMolecule.atoms.data(revisionId))
 * const isDirty = useAtomValue(ossAppRevisionMolecule.atoms.isDirty(revisionId))
 * const schema = useAtomValue(ossAppRevisionMolecule.atoms.agConfigSchema(revisionId))
 *
 * // Actions
 * const update = useSetAtom(ossAppRevisionMolecule.reducers.update)
 * update(revisionId, { parameters: newParams })
 *
 * // Imperative API
 * ossAppRevisionMolecule.set.update(revisionId, { parameters: newParams })
 * ```
 */

import {useMemo} from "react"

import {
    getValueAtPath as getValueAtPathUtil,
    setValueAtPath,
    type DataPath,
} from "@agenta/shared/utils"
import type {Atom} from "jotai"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import type {EntitySchema, EntitySchemaProperty, PathItem, StoreOptions} from "../../shared"
import type {OssAppRevisionData, RevisionSchemaState, ExecutionMode} from "../core"
import {
    createLocalOssAppRevision,
    cloneAsLocalDraft,
    type CreateLocalOssAppRevisionParams,
    type LocalOssAppRevision,
} from "../core/factory"

import {
    // Commit abstraction
    commitRevisionAtom,
    type CommitRevisionParams,
    type CommitResult,
} from "./commit"
import {
    // Runnable extension atoms
    runnableAtoms,
    runnableReducers,
    runnableGet,
    runnableSet,
    type OssAppRevisionOutputPort,
} from "./runnableSetup"
import {
    // Schema selectors
    ossAppRevisionSchemaQueryAtomFamily,
    revisionAgConfigSchemaAtomFamily,
    revisionPromptSchemaAtomFamily,
    revisionCustomPropertiesSchemaAtomFamily,
    revisionSchemaAtPathAtomFamily,
    revisionEndpointsAtomFamily,
    // Enhanced custom properties
    revisionEnhancedCustomPropertiesAtomFamily,
    revisionCustomPropertyKeysAtomFamily,
    type EnhancedCustomProperty,
} from "./schemaAtoms"
import {
    // Store atoms
    ossAppRevisionQueryAtomFamily,
    ossAppRevisionDraftAtomFamily,
    ossAppRevisionInputPortsAtomFamily,
    type OssAppRevisionInputPort,
    // Bridge-aware atoms
    ossAppRevisionServerDataAtomFamily,
    ossAppRevisionEntityWithBridgeAtomFamily,
    ossAppRevisionServerDataSelectorFamily,
    ossAppRevisionIsDirtyWithBridgeAtomFamily,
    // List atoms
    appsListAtom,
    variantsListAtomFamily,
    revisionsListAtomFamily,
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
    // Query atoms
    appsQueryAtom,
    variantsQueryAtomFamily,
    revisionsQueryAtomFamily,
    // Mutations
    updateOssAppRevisionAtom,
    discardOssAppRevisionDraftAtom,
    // Server data management
    setServerDataAtom,
    clearServerDataAtom,
    // Enhanced prompts/custom properties
    setEnhancedPromptsAtom,
    mutateEnhancedPromptsAtom,
    setEnhancedCustomPropertiesAtom,
    mutateEnhancedCustomPropertiesAtom,
    updatePropertyAtom,
} from "./store"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// DRILL-IN HELPERS
// ============================================================================

/**
 * Get value at path from OSS app revision data
 */
function getValueAtPath(data: OssAppRevisionData | null, path: DataPath): unknown {
    if (!data) return undefined
    // For legacyAppRevision, we navigate into parameters
    if (data.parameters && Object.keys(data.parameters).length > 0) {
        return getValueAtPathUtil(data.parameters, path)
    }
    return getValueAtPathUtil(data, path)
}

/**
 * Get root items for navigation.
 * Uses parameters for schema-driven approach.
 */
function getRootItems(data: OssAppRevisionData | null): PathItem[] {
    if (!data) return []

    // Schema-driven mode: use parameters directly
    if (data.parameters && Object.keys(data.parameters).length > 0) {
        return Object.entries(data.parameters).map(([key, value]) => ({
            key,
            name: formatKeyAsName(key),
            value,
        }))
    }

    return []
}

/**
 * Convert path-based changes to draft format.
 */
function getChangesFromPath(
    data: OssAppRevisionData | null,
    path: DataPath,
    value: unknown,
): Partial<OssAppRevisionData> | null {
    if (!data || path.length === 0) return null

    // If using parameters mode
    if (data.parameters && Object.keys(data.parameters).length > 0) {
        const updated = setValueAtPath(data.parameters, path, value)
        return {parameters: updated as Record<string, unknown>}
    }

    return null
}

/**
 * Format a key as a human-readable name
 */
function formatKeyAsName(key: string): string {
    const withSpaces = key.replace(/_/g, " ")
    const withCamelSpaces = withSpaces.replace(/([a-z])([A-Z])/g, "$1 $2")
    return withCamelSpaces
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
}

// ============================================================================
// CONTROLLER TYPES
// ============================================================================

/**
 * State returned by useController hook for legacyAppRevision
 */
export interface OssAppRevisionControllerState {
    /** Merged entity data (draft or server) */
    data: OssAppRevisionData | null
    /** Server data (from query or bridge) */
    serverData: OssAppRevisionData | null
    /** Whether the entity has local changes */
    isDirty: boolean
    /** Whether the query is loading */
    isPending: boolean
    /** Whether the query has an error */
    isError: boolean
    /** Query error if any */
    error: Error | null
}

/**
 * Dispatch methods returned by useController hook for legacyAppRevision
 */
export interface OssAppRevisionControllerDispatch {
    /** Update entity draft with partial changes */
    update: (changes: Partial<OssAppRevisionData>) => void
    /** Discard local draft changes */
    discard: () => void
    /** Set enhanced prompts */
    setEnhancedPrompts: (prompts: unknown[]) => void
    /** Set enhanced custom properties */
    setEnhancedCustomProperties: (props: Record<string, unknown>) => void
    /** Update a property by __id */
    updateProperty: (propertyId: string, value: unknown) => void
    /** Commit changes to create a new revision */
    commit: (params: Omit<CommitRevisionParams, "revisionId">) => Promise<CommitResult>
    /** Set execution mode */
    setExecutionMode: (mode: ExecutionMode) => void
}

/**
 * Return type of useController hook
 */
export type OssAppRevisionControllerResult = [
    OssAppRevisionControllerState,
    OssAppRevisionControllerDispatch,
]

// ============================================================================
// USE CONTROLLER HOOK
// ============================================================================

/**
 * React hook that combines state + dispatch for a single legacyAppRevision entity.
 *
 * This is the recommended way for UI components to interact with legacyAppRevision state.
 * It provides a stable API that abstracts away the underlying atom implementation.
 *
 * @example
 * ```typescript
 * function VariantConfig({ revisionId }: { revisionId: string }) {
 *   const [state, dispatch] = useOssAppRevisionController(revisionId)
 *
 *   if (state.isPending) return <Skeleton />
 *   if (!state.data) return <NotFound />
 *
 *   const handleChange = (propertyId: string, value: unknown) => {
 *     dispatch.updateProperty(propertyId, value)
 *   }
 *
 *   return (
 *     <div>
 *       <span>{state.isDirty ? 'Modified' : 'Saved'}</span>
 *       <PropertyEditor data={state.data} onChange={handleChange} />
 *       <Button onClick={dispatch.discard}>Discard</Button>
 *     </div>
 *   )
 * }
 * ```
 */
export function useOssAppRevisionController(revisionId: string): OssAppRevisionControllerResult {
    // Read state atoms
    const data = useAtomValue(ossAppRevisionEntityWithBridgeAtomFamily(revisionId))
    const serverData = useAtomValue(ossAppRevisionServerDataSelectorFamily(revisionId))
    const query = useAtomValue(ossAppRevisionQueryAtomFamily(revisionId))
    const isDirty = useAtomValue(ossAppRevisionIsDirtyWithBridgeAtomFamily(revisionId))

    // Get dispatch setters
    const setUpdate = useSetAtom(updateOssAppRevisionAtom)
    const setDiscard = useSetAtom(discardOssAppRevisionDraftAtom)
    const setEnhancedPromptsAtomSetter = useSetAtom(setEnhancedPromptsAtom)
    const setEnhancedCustomPropertiesAtomSetter = useSetAtom(setEnhancedCustomPropertiesAtom)
    const setUpdatePropertyAtomSetter = useSetAtom(updatePropertyAtom)
    const setCommit = useSetAtom(commitRevisionAtom)
    const setExecutionModeAtom = useSetAtom(runnableReducers.setExecutionMode)

    // Build state object
    const state: OssAppRevisionControllerState = {
        data,
        serverData,
        isDirty,
        isPending: query.isPending,
        isError: query.isError,
        error: query.error ?? null,
    }

    // Build dispatch object with memoized callbacks
    const dispatch: OssAppRevisionControllerDispatch = useMemo(
        () => ({
            update: (changes: Partial<OssAppRevisionData>) => setUpdate(revisionId, changes),
            discard: () => setDiscard(revisionId),
            setEnhancedPrompts: (prompts: unknown[]) =>
                setEnhancedPromptsAtomSetter(revisionId, prompts),
            setEnhancedCustomProperties: (props: Record<string, unknown>) =>
                setEnhancedCustomPropertiesAtomSetter(revisionId, props),
            updateProperty: (propertyId: string, value: unknown) =>
                setUpdatePropertyAtomSetter({revisionId, propertyId, value}),
            commit: (params: Omit<CommitRevisionParams, "revisionId">) =>
                setCommit({...params, revisionId}),
            setExecutionMode: (mode: ExecutionMode) => setExecutionModeAtom(revisionId, mode),
        }),
        [
            revisionId,
            setUpdate,
            setDiscard,
            setEnhancedPromptsAtomSetter,
            setEnhancedCustomPropertiesAtomSetter,
            setUpdatePropertyAtomSetter,
            setCommit,
            setExecutionModeAtom,
        ],
    )

    return [state, dispatch]
}

// ============================================================================
// MOLECULE EXPORT
// ============================================================================

/**
 * LegacyAppRevision molecule - unified API for OSS app revision entity management
 *
 * This molecule uses the legacy backend API (AppVariantRevision model).
 */
export const ossAppRevisionMolecule = {
    /** Entity name */
    name: "legacyAppRevision" as const,

    // ========================================================================
    // ATOMS
    // ========================================================================
    atoms: {
        // Entity atoms
        /** Query atom (server data) */
        query: ossAppRevisionQueryAtomFamily,
        /** Draft atom (local edits) */
        draft: ossAppRevisionDraftAtomFamily,
        /** Entity atom (merged data) - bridge-aware, prefers synced data */
        data: ossAppRevisionEntityWithBridgeAtomFamily,
        /** Dirty state - bridge-aware */
        isDirty: ossAppRevisionIsDirtyWithBridgeAtomFamily,
        /** Input ports derived from parameters template */
        inputPorts: ossAppRevisionInputPortsAtomFamily,
        /** Server data (bridge or query) */
        serverData: ossAppRevisionServerDataSelectorFamily,
        /** Raw server data from bridge */
        bridgeServerData: ossAppRevisionServerDataAtomFamily,

        // Execution mode atoms (from runnable extension)
        /** Execution mode (draft/deployed) */
        executionMode: runnableAtoms.executionMode,
        /** Endpoint based on mode (/test or /run) */
        endpoint: runnableAtoms.endpoint,
        /** Full invocation URL */
        invocationUrl: runnableAtoms.invocationUrl,
        /** Output ports */
        outputPorts: runnableAtoms.outputPorts,

        // Schema atoms
        /** Schema query (full state) */
        schemaQuery: ossAppRevisionSchemaQueryAtomFamily,
        /** ag_config schema */
        agConfigSchema: revisionAgConfigSchemaAtomFamily,
        /** Prompt schema (x-parameters.prompt === true) */
        promptSchema: revisionPromptSchemaAtomFamily,
        /** Custom properties schema (non-prompt) */
        customPropertiesSchema: revisionCustomPropertiesSchemaAtomFamily,
        /** Schema loading state */
        schemaLoading: runnableAtoms.schemaLoading,
        /** Schema at path */
        schemaAtPath: revisionSchemaAtPathAtomFamily,
        /** Endpoints */
        endpoints: revisionEndpointsAtomFamily,
        /** Available endpoints */
        availableEndpoints: runnableAtoms.availableEndpoints,
        /** Is chat variant */
        isChatVariant: runnableAtoms.isChatVariant,
        /** Inputs schema */
        inputsSchema: runnableAtoms.inputsSchema,
        /** Messages schema */
        messagesSchema: runnableAtoms.messagesSchema,
        /** Runtime prefix */
        runtimePrefix: runnableAtoms.runtimePrefix,
        /** Route path */
        routePath: runnableAtoms.routePath,
    },

    // ========================================================================
    // SELECTORS (aliases for common patterns)
    // ========================================================================
    selectors: {
        data: ossAppRevisionEntityWithBridgeAtomFamily,
        serverData: ossAppRevisionServerDataSelectorFamily,
        draft: ossAppRevisionDraftAtomFamily,
        isDirty: ossAppRevisionIsDirtyWithBridgeAtomFamily,
        query: ossAppRevisionQueryAtomFamily,
        bridgeServerData: ossAppRevisionServerDataAtomFamily,

        /**
         * Input ports derived from the revision's parameters template.
         */
        inputPorts: (revisionId: string): Atom<OssAppRevisionInputPort[]> =>
            ossAppRevisionInputPortsAtomFamily(revisionId),

        /**
         * Output ports derived from the revision's OpenAPI schema response.
         */
        outputPorts: (revisionId: string): Atom<OssAppRevisionOutputPort[]> =>
            runnableAtoms.outputPorts(revisionId),

        // Execution mode
        executionMode: (revisionId: string): Atom<ExecutionMode> =>
            runnableAtoms.executionMode(revisionId),
        endpoint: (revisionId: string): Atom<string> => runnableAtoms.endpoint(revisionId),
        invocationUrl: (revisionId: string): Atom<string | null> =>
            runnableAtoms.invocationUrl(revisionId),

        // Schema selectors
        schemaQuery: ossAppRevisionSchemaQueryAtomFamily,
        agConfigSchema: (revisionId: string): Atom<EntitySchema | null> =>
            revisionAgConfigSchemaAtomFamily(revisionId),
        schemaLoading: (revisionId: string): Atom<boolean> =>
            runnableAtoms.schemaLoading(revisionId),
        promptSchema: (revisionId: string): Atom<EntitySchema | null> =>
            revisionPromptSchemaAtomFamily(revisionId),
        customPropertiesSchema: (revisionId: string): Atom<EntitySchema | null> =>
            revisionCustomPropertiesSchemaAtomFamily(revisionId),
        /** Enhanced custom properties with values (derived from schema + parameters) */
        enhancedCustomProperties: (
            revisionId: string,
        ): Atom<Record<string, EnhancedCustomProperty>> =>
            revisionEnhancedCustomPropertiesAtomFamily(revisionId),
        /** Custom property keys for a revision */
        customPropertyKeys: (revisionId: string): Atom<string[]> =>
            revisionCustomPropertyKeysAtomFamily(revisionId),
        schemaAtPath: (params: {
            revisionId: string
            path: (string | number)[]
        }): Atom<EntitySchemaProperty | null> => revisionSchemaAtPathAtomFamily(params),
        endpoints: (revisionId: string): Atom<RevisionSchemaState["endpoints"]> =>
            revisionEndpointsAtomFamily(revisionId),
        availableEndpoints: (revisionId: string): Atom<string[]> =>
            runnableAtoms.availableEndpoints(revisionId),
        isChatVariant: (revisionId: string): Atom<boolean> =>
            runnableAtoms.isChatVariant(revisionId),
        inputsSchema: (params: {revisionId: string; endpoint?: string}) =>
            runnableAtoms.inputsSchema({id: params.revisionId, endpoint: params.endpoint}),
        messagesSchema: (params: {revisionId: string; endpoint?: string}) =>
            runnableAtoms.messagesSchema({id: params.revisionId, endpoint: params.endpoint}),
        runtimePrefix: (revisionId: string): Atom<string | undefined> =>
            runnableAtoms.runtimePrefix(revisionId),
        routePath: (revisionId: string): Atom<string | undefined> =>
            runnableAtoms.routePath(revisionId),

        // ====================================================================
        // LIST SELECTORS (for hierarchical entity selection)
        // ====================================================================

        /** Get all apps for the current project */
        apps: appsListAtom as Atom<AppListItem[]>,

        /** Get variants for a specific app */
        variantsByApp: (appId: string): Atom<VariantListItem[]> =>
            variantsListAtomFamily(appId) as Atom<VariantListItem[]>,

        /** Get revisions for a specific variant */
        revisions: (variantId: string): Atom<RevisionListItem[]> =>
            revisionsListAtomFamily(variantId) as Atom<RevisionListItem[]>,

        // ====================================================================
        // QUERY STATE SELECTORS (for loading/error states)
        // ====================================================================

        /** Apps query state */
        appsQuery: appsQueryAtom,

        /** Variants query state for a specific app */
        variantsQuery: variantsQueryAtomFamily,

        /** Revisions query state for a specific variant */
        revisionsQuery: revisionsQueryAtomFamily,
    },

    // ========================================================================
    // REDUCERS
    // ========================================================================
    reducers: {
        /** Update revision draft */
        update: updateOssAppRevisionAtom,
        /** Discard revision draft */
        discard: discardOssAppRevisionDraftAtom,
        /** Set execution mode */
        setExecutionMode: runnableReducers.setExecutionMode,
        /** Set server data (for bridge sync) */
        setServerData: setServerDataAtom,
        /** Clear server data */
        clearServerData: clearServerDataAtom,
        /** Set enhanced prompts */
        setEnhancedPrompts: setEnhancedPromptsAtom,
        /** Mutate enhanced prompts with Immer recipe */
        mutateEnhancedPrompts: mutateEnhancedPromptsAtom,
        /** Set enhanced custom properties */
        setEnhancedCustomProperties: setEnhancedCustomPropertiesAtom,
        /** Mutate enhanced custom properties with Immer recipe */
        mutateEnhancedCustomProperties: mutateEnhancedCustomPropertiesAtom,
        /** Update property by __id */
        updateProperty: updatePropertyAtom,
    },

    // ========================================================================
    // ACTIONS (alias for backwards compatibility)
    // ========================================================================
    actions: {
        update: updateOssAppRevisionAtom,
        discard: discardOssAppRevisionDraftAtom,
        setExecutionMode: runnableReducers.setExecutionMode,
        setServerData: setServerDataAtom,
        clearServerData: clearServerDataAtom,
        setEnhancedPrompts: setEnhancedPromptsAtom,
        mutateEnhancedPrompts: mutateEnhancedPromptsAtom,
        setEnhancedCustomProperties: setEnhancedCustomPropertiesAtom,
        mutateEnhancedCustomProperties: mutateEnhancedCustomPropertiesAtom,
        updateProperty: updatePropertyAtom,
        /**
         * Commit changes to create a new revision.
         *
         * LEGACY: This action encapsulates the workaround for the API not
         * returning new revision IDs. Will be replaced when migrating to appRevision.
         *
         * @example
         * ```typescript
         * const result = await set(ossAppRevisionMolecule.actions.commit, {
         *   revisionId: currentId,
         *   variantId,
         *   parameters: { ag_config: {...} },
         *   commitMessage: 'Updated prompts',
         * })
         * ```
         */
        commit: commitRevisionAtom,

        /**
         * Create a local draft by cloning an existing revision.
         *
         * This action creates a new local draft entity in the store,
         * copying data from an existing revision. The new draft can be
         * edited and later committed as a new revision.
         *
         * @example
         * ```typescript
         * const { id, data } = set(ossAppRevisionMolecule.actions.createLocalDraft, {
         *   sourceRevisionId: 'existing-revision-id',
         *   variantName: 'My Copy',
         * })
         * // id is the new local draft ID
         * // data is the cloned revision data
         * ```
         */
        createLocalDraft: atom(
            null,
            (
                get,
                set,
                params: {
                    sourceRevisionId: string
                    variantId?: string
                    variantName?: string
                },
            ): LocalOssAppRevision => {
                const sourceData = get(
                    ossAppRevisionEntityWithBridgeAtomFamily(params.sourceRevisionId),
                )
                if (!sourceData) {
                    throw new Error(`Source revision not found: ${params.sourceRevisionId}`)
                }

                const result = cloneAsLocalDraft(sourceData, {
                    variantId: params.variantId,
                    variantName: params.variantName,
                })

                // Initialize the new draft in the store
                set(ossAppRevisionServerDataAtomFamily(result.id), result.data)

                return result
            },
        ),

        /**
         * Create a new local draft from scratch (not cloning).
         *
         * @example
         * ```typescript
         * const { id, data } = set(ossAppRevisionMolecule.actions.createNewDraft, {
         *   variantId: 'variant-123',
         *   variantName: 'New Variant',
         * })
         * ```
         */
        createNewDraft: atom(
            null,
            (_get, set, params: CreateLocalOssAppRevisionParams): LocalOssAppRevision => {
                const result = createLocalOssAppRevision(params)

                // Initialize the new draft in the store
                set(ossAppRevisionServerDataAtomFamily(result.id), result.data)

                return result
            },
        ),
    },

    // ========================================================================
    // DRILL-IN CONFIG
    // ========================================================================
    drillIn: {
        getValueAtPath,
        getRootItems,
        getChangesFromPath,
        valueMode: "native" as const,
        getRootData: (entity: OssAppRevisionData | null) => {
            if (entity?.parameters && Object.keys(entity.parameters).length > 0) {
                return entity.parameters
            }
            return entity
        },
        getChangesFromRoot: (
            entity: OssAppRevisionData | null,
            _rootData: unknown,
            path: DataPath,
            value: unknown,
        ): Partial<OssAppRevisionData> | null => {
            return getChangesFromPath(entity, path, value)
        },
    },

    // ========================================================================
    // IMPERATIVE API
    // ========================================================================
    get: {
        data: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(ossAppRevisionEntityWithBridgeAtomFamily(revisionId)),
        serverData: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(ossAppRevisionServerDataSelectorFamily(revisionId)),
        draft: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(ossAppRevisionDraftAtomFamily(revisionId)),
        isDirty: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(ossAppRevisionIsDirtyWithBridgeAtomFamily(revisionId)),
        /** Get input ports derived from parameters template */
        inputPorts: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(ossAppRevisionInputPortsAtomFamily(revisionId)),
        // Execution mode
        executionMode: (revisionId: string, options?: StoreOptions) =>
            runnableGet.executionMode(revisionId, options),
        endpoint: (revisionId: string, options?: StoreOptions) =>
            runnableGet.endpoint(revisionId, options),
        invocationUrl: (revisionId: string, options?: StoreOptions) =>
            runnableGet.invocationUrl(revisionId, options),
        agConfigSchema: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(revisionAgConfigSchemaAtomFamily(revisionId)),
    },

    set: {
        update: (
            revisionId: string,
            changes: Partial<OssAppRevisionData>,
            options?: StoreOptions,
        ) => getStore(options).set(updateOssAppRevisionAtom, revisionId, changes),
        discard: (revisionId: string, options?: StoreOptions) =>
            getStore(options).set(discardOssAppRevisionDraftAtom, revisionId),
        // Execution mode
        executionMode: (revisionId: string, mode: ExecutionMode, options?: StoreOptions) =>
            runnableSet.executionMode(revisionId, mode, options),
        // Server data management (for bridge)
        serverData: (revisionId: string, data: OssAppRevisionData, options?: StoreOptions) =>
            getStore(options).set(setServerDataAtom, revisionId, data),
        clearServerData: (revisionId: string, options?: StoreOptions) =>
            getStore(options).set(clearServerDataAtom, revisionId),
        // Enhanced prompts/custom properties
        setEnhancedPrompts: (revisionId: string, prompts: unknown[], options?: StoreOptions) =>
            getStore(options).set(setEnhancedPromptsAtom, revisionId, prompts),
        setEnhancedCustomProperties: (
            revisionId: string,
            customProperties: Record<string, unknown>,
            options?: StoreOptions,
        ) => getStore(options).set(setEnhancedCustomPropertiesAtom, revisionId, customProperties),
        updateProperty: (
            revisionId: string,
            propertyId: string,
            value: unknown,
            options?: StoreOptions,
        ) => getStore(options).set(updatePropertyAtom, {revisionId, propertyId, value}),
        /**
         * Commit changes to create a new revision (imperative API).
         *
         * LEGACY: Encapsulates the workaround for the API not returning new revision IDs.
         */
        commit: (params: CommitRevisionParams, options?: StoreOptions): Promise<CommitResult> =>
            getStore(options).set(commitRevisionAtom, params),
    },

    // ========================================================================
    // RUNNABLE CAPABILITY (RunnableCapability interface)
    // ========================================================================
    /**
     * Runnable capability - provides unified access to input/output ports,
     * configuration, and invocation URL.
     */
    runnable: {
        /**
         * Input port definitions for this runnable.
         * Derived from the parameters template variables.
         */
        inputPorts: ossAppRevisionInputPortsAtomFamily,
        /**
         * Output port definitions for this runnable.
         * Derived from the OpenAPI schema response.
         */
        outputPorts: runnableAtoms.outputPorts,
        /**
         * Configuration schema for this runnable.
         */
        config: revisionAgConfigSchemaAtomFamily,
        /**
         * URL to invoke this runnable.
         * Depends on execution mode (draft: /test, deployed: /run).
         */
        invocationUrl: runnableAtoms.invocationUrl,
    },

    // ========================================================================
    // REACT HOOK
    // ========================================================================

    /**
     * React hook that combines state + dispatch for a single entity.
     *
     * This is the recommended way for UI components to interact with legacyAppRevision state.
     *
     * @example
     * ```typescript
     * const [state, dispatch] = ossAppRevisionMolecule.useController(revisionId)
     * if (state.isDirty) dispatch.discard()
     * ```
     */
    useController: useOssAppRevisionController,
}

// ============================================================================
// SELECTION CONFIG
// ============================================================================

/**
 * Pre-built selection config for entity selection system.
 */
export const ossAppRevisionSelectionConfig = {
    appsAtom: ossAppRevisionMolecule.selectors.apps,
    variantsByAppFamily: (appId: string) => ossAppRevisionMolecule.selectors.variantsByApp(appId),
    revisionsByVariantFamily: (variantId: string) =>
        ossAppRevisionMolecule.selectors.revisions(variantId),
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type OssAppRevisionMolecule = typeof ossAppRevisionMolecule
export type OssAppRevisionSelectionConfig = typeof ossAppRevisionSelectionConfig
