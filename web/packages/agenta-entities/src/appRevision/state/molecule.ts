/**
 * AppRevision Molecule
 *
 * Unified API for app revision entity state management.
 * Uses the molecule pattern for consistency with other entities.
 *
 * @example
 * ```typescript
 * import { appRevisionMolecule } from '@agenta/entities/appRevision'
 *
 * // Selectors
 * const data = useAtomValue(appRevisionMolecule.atoms.data(revisionId))
 * const isDirty = useAtomValue(appRevisionMolecule.atoms.isDirty(revisionId))
 * const schema = useAtomValue(appRevisionMolecule.atoms.agConfigSchema(revisionId))
 *
 * // Actions
 * const update = useSetAtom(appRevisionMolecule.reducers.update)
 * update(revisionId, { agConfig: newConfig })
 *
 * // Imperative API
 * appRevisionMolecule.set.update(revisionId, { agConfig: newConfig })
 * ```
 */

import {
    getValueAtPath as getValueAtPathUtil,
    setValueAtPath,
    type DataPath,
} from "@agenta/shared/utils"
import type {Atom} from "jotai"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import type {EntitySchema, EntitySchemaProperty, PathItem, StoreOptions} from "../../shared"
import type {AppRevisionData, RevisionSchemaState, ExecutionMode} from "../core"

import {
    // Runnable extension atoms (execution mode, schema selectors)
    runnableAtoms,
    runnableReducers,
    runnableGet,
    runnableSet,
} from "./runnableSetup"
import {
    // Schema selectors (appRevision-specific)
    appRevisionSchemaQueryAtomFamily,
    revisionAgConfigSchemaAtomFamily,
    revisionPromptSchemaAtomFamily,
    revisionCustomPropertiesSchemaAtomFamily,
    revisionSchemaAtPathAtomFamily,
    revisionEndpointsAtomFamily,
} from "./schemaAtoms"
import {
    // Store atoms
    appRevisionQueryAtomFamily,
    appRevisionDraftAtomFamily,
    appRevisionEntityAtomFamily,
    appRevisionIsDirtyAtomFamily,
    appRevisionInputPortsAtomFamily,
    type AppRevisionInputPort,
    // List atoms
    appsListAtom,
    variantsListAtomFamily,
    revisionsListAtomFamily,
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
    // Mutations
    updateAppRevisionAtom,
    discardAppRevisionDraftAtom,
    updatePromptAtom,
    updateMessageAtom,
    addMessageAtom,
    deleteMessageAtom,
    reorderMessagesAtom,
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
 * Get value at path from app revision data
 */
function getValueAtPath(data: AppRevisionData | null, path: DataPath): unknown {
    if (!data) return undefined
    // For appRevision, we navigate into agConfig
    if (data.agConfig && Object.keys(data.agConfig).length > 0) {
        return getValueAtPathUtil(data.agConfig, path)
    }
    return getValueAtPathUtil(data, path)
}

/**
 * Get root items for navigation.
 * Prefers agConfig for schema-driven approach.
 */
function getRootItems(data: AppRevisionData | null): PathItem[] {
    if (!data) return []

    // Schema-driven mode: use agConfig directly
    if (data.agConfig && Object.keys(data.agConfig).length > 0) {
        return Object.entries(data.agConfig).map(([key, value]) => ({
            key,
            name: formatKeyAsName(key),
            value,
        }))
    }

    // Legacy mode: use prompts and parameters
    const items: PathItem[] = []

    if (data.prompts && data.prompts.length > 0) {
        items.push({
            key: "prompts",
            name: "Prompts",
            value: data.prompts,
        })
    }

    if (data.parameters && Object.keys(data.parameters).length > 0) {
        items.push({
            key: "parameters",
            name: "Parameters",
            value: data.parameters,
        })
    }

    return items
}

/**
 * Convert path-based changes to draft format.
 */
function getChangesFromPath(
    data: AppRevisionData | null,
    path: DataPath,
    value: unknown,
): Partial<AppRevisionData> | null {
    if (!data || path.length === 0) return null

    // If using agConfig mode
    if (data.agConfig && Object.keys(data.agConfig).length > 0) {
        const updated = setValueAtPath(data.agConfig, path, value)
        return {agConfig: updated as Record<string, unknown>}
    }

    // Legacy mode - direct path update
    const topKey = path[0]
    if (typeof topKey === "string") {
        const updated = setValueAtPath(data, path, value)
        return {
            [topKey]: (updated as Record<string, unknown>)[topKey],
        } as Partial<AppRevisionData>
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
// OUTPUT PORTS
// ============================================================================

/**
 * Output port type for app revisions
 */
export interface AppRevisionOutputPort {
    key: string
    name: string
    type: string
    description?: string
}

/**
 * Output ports derived from the revision's OpenAPI schema response.
 * This is the single source of truth for "what outputs does this revision produce".
 */
const appRevisionOutputPortsAtomFamily = atomFamily((revisionId: string) =>
    atom<AppRevisionOutputPort[]>((get) => {
        const schemaQuery = get(appRevisionSchemaQueryAtomFamily(revisionId))

        const outputsSchema = schemaQuery.data?.outputsSchema
        if (!outputsSchema?.properties) {
            // Default output port if no schema defined
            return [
                {
                    key: "output",
                    name: "Output",
                    type: "string",
                },
            ]
        }

        const props = outputsSchema.properties as Record<
            string,
            {type?: string; description?: string}
        >

        return Object.entries(props).map(([key, prop]) => ({
            key,
            name: key,
            type: prop.type || "string",
            description: prop.description,
        }))
    }),
)

// ============================================================================
// MOLECULE EXPORT
// ============================================================================

/**
 * AppRevision molecule - unified API for app revision entity management
 */
export const appRevisionMolecule = {
    /** Entity name */
    name: "appRevision" as const,

    // ========================================================================
    // ATOMS
    // ========================================================================
    atoms: {
        // Entity atoms
        /** Query atom (server data) */
        query: appRevisionQueryAtomFamily,
        /** Draft atom (local edits) */
        draft: appRevisionDraftAtomFamily,
        /** Entity atom (merged data) */
        data: appRevisionEntityAtomFamily,
        /** Dirty state */
        isDirty: appRevisionIsDirtyAtomFamily,
        /** Input ports derived from agConfig prompt template */
        inputPorts: appRevisionInputPortsAtomFamily,

        // Execution mode atoms (from runnable extension)
        /** Execution mode (draft/deployed) */
        executionMode: runnableAtoms.executionMode,
        /** Endpoint based on mode (/test or /run) */
        endpoint: runnableAtoms.endpoint,
        /** Full invocation URL */
        invocationUrl: runnableAtoms.invocationUrl,

        // Schema atoms (from runnable extension + appRevision-specific)
        /** Schema query (full state) */
        schemaQuery: appRevisionSchemaQueryAtomFamily,
        /** ag_config schema (maps to runnable configSchema) */
        agConfigSchema: revisionAgConfigSchemaAtomFamily,
        /** Prompt schema (x-parameters.prompt === true) - appRevision-specific */
        promptSchema: revisionPromptSchemaAtomFamily,
        /** Custom properties schema (non-prompt) - appRevision-specific */
        customPropertiesSchema: revisionCustomPropertiesSchemaAtomFamily,
        /** Schema loading state (from runnable) */
        schemaLoading: runnableAtoms.schemaLoading,
        /** Schema at path - appRevision-specific */
        schemaAtPath: revisionSchemaAtPathAtomFamily,
        /** Endpoints - appRevision-specific (includes generate endpoints) */
        endpoints: revisionEndpointsAtomFamily,
        /** Available endpoints (from runnable) */
        availableEndpoints: runnableAtoms.availableEndpoints,
        /** Is chat variant (from runnable) */
        isChatVariant: runnableAtoms.isChatVariant,
        /** Inputs schema (from runnable) */
        inputsSchema: runnableAtoms.inputsSchema,
        /** Messages schema (from runnable) */
        messagesSchema: runnableAtoms.messagesSchema,
        /** Runtime prefix (from runnable) */
        runtimePrefix: runnableAtoms.runtimePrefix,
        /** Route path (from runnable) */
        routePath: runnableAtoms.routePath,
    },

    // ========================================================================
    // SELECTORS (aliases for common patterns)
    // ========================================================================
    selectors: {
        data: appRevisionEntityAtomFamily,
        serverData: (revisionId: string) => appRevisionQueryAtomFamily(revisionId),
        draft: appRevisionDraftAtomFamily,
        isDirty: appRevisionIsDirtyAtomFamily,
        query: appRevisionQueryAtomFamily,

        /**
         * Input ports derived from the revision's agConfig prompt template.
         * Returns an array of input port definitions extracted from template variables.
         * This is the single source of truth for "what inputs does this revision expect".
         */
        inputPorts: (revisionId: string): Atom<AppRevisionInputPort[]> =>
            appRevisionInputPortsAtomFamily(revisionId),

        /**
         * Output ports derived from the revision's OpenAPI schema response.
         * Returns an array of output port definitions extracted from the response schema.
         * This is the single source of truth for "what outputs does this revision produce".
         */
        outputPorts: (revisionId: string): Atom<AppRevisionOutputPort[]> =>
            appRevisionOutputPortsAtomFamily(revisionId),

        // Execution mode (from runnable)
        executionMode: (revisionId: string): Atom<ExecutionMode> =>
            runnableAtoms.executionMode(revisionId),
        endpoint: (revisionId: string): Atom<string> => runnableAtoms.endpoint(revisionId),
        invocationUrl: (revisionId: string): Atom<string | null> =>
            runnableAtoms.invocationUrl(revisionId),

        // Schema selectors
        schemaQuery: appRevisionSchemaQueryAtomFamily,
        agConfigSchema: (revisionId: string): Atom<EntitySchema | null> =>
            revisionAgConfigSchemaAtomFamily(revisionId),
        schemaLoading: (revisionId: string): Atom<boolean> =>
            runnableAtoms.schemaLoading(revisionId),
        promptSchema: (revisionId: string): Atom<EntitySchema | null> =>
            revisionPromptSchemaAtomFamily(revisionId),
        customPropertiesSchema: (revisionId: string): Atom<EntitySchema | null> =>
            revisionCustomPropertiesSchemaAtomFamily(revisionId),
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

        // ========================================================================
        // LIST SELECTORS (for hierarchical entity selection)
        // ========================================================================

        /**
         * Get all apps for the current project.
         * Must be initialized with setAppsListAtom from OSS layer.
         */
        apps: appsListAtom as Atom<AppListItem[]>,

        /**
         * Get variants for a specific app.
         * Must be initialized with setVariantsListAtomFamily from OSS layer.
         */
        variantsByApp: (appId: string): Atom<VariantListItem[]> =>
            variantsListAtomFamily(appId) as Atom<VariantListItem[]>,

        /**
         * Get revisions for a specific variant.
         * Must be initialized with setRevisionsListAtomFamily from OSS layer.
         */
        revisions: (variantId: string): Atom<RevisionListItem[]> =>
            revisionsListAtomFamily(variantId) as Atom<RevisionListItem[]>,
    },

    // ========================================================================
    // REDUCERS
    // ========================================================================
    reducers: {
        /** Update revision draft */
        update: updateAppRevisionAtom,
        /** Discard revision draft */
        discard: discardAppRevisionDraftAtom,
        /** Set execution mode (from runnable) */
        setExecutionMode: runnableReducers.setExecutionMode,
        /** Update specific prompt */
        updatePrompt: updatePromptAtom,
        /** Update specific message */
        updateMessage: updateMessageAtom,
        /** Add message to prompt */
        addMessage: addMessageAtom,
        /** Delete message from prompt */
        deleteMessage: deleteMessageAtom,
        /** Reorder messages */
        reorderMessages: reorderMessagesAtom,
    },

    // ========================================================================
    // ACTIONS (alias for backwards compatibility)
    // ========================================================================
    actions: {
        update: updateAppRevisionAtom,
        discard: discardAppRevisionDraftAtom,
        setExecutionMode: runnableReducers.setExecutionMode,
        updatePrompt: updatePromptAtom,
        updateMessage: updateMessageAtom,
        addMessage: addMessageAtom,
        deleteMessage: deleteMessageAtom,
        reorderMessages: reorderMessagesAtom,
    },

    // ========================================================================
    // DRILL-IN CONFIG
    // ========================================================================
    drillIn: {
        getValueAtPath,
        getRootItems,
        getChangesFromPath,
        valueMode: "native" as const,
        getRootData: (entity: AppRevisionData | null) => {
            if (entity?.agConfig && Object.keys(entity.agConfig).length > 0) {
                return entity.agConfig
            }
            return entity
        },
        getChangesFromRoot: (
            entity: AppRevisionData | null,
            _rootData: unknown,
            path: DataPath,
            value: unknown,
        ): Partial<AppRevisionData> | null => {
            return getChangesFromPath(entity, path, value)
        },
    },

    // ========================================================================
    // IMPERATIVE API
    // ========================================================================
    get: {
        data: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(appRevisionEntityAtomFamily(revisionId)),
        serverData: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(appRevisionQueryAtomFamily(revisionId)).data,
        draft: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(appRevisionDraftAtomFamily(revisionId)),
        isDirty: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(appRevisionIsDirtyAtomFamily(revisionId)),
        /** Get input ports derived from agConfig prompt template */
        inputPorts: (revisionId: string, options?: StoreOptions) =>
            getStore(options).get(appRevisionInputPortsAtomFamily(revisionId)),
        // Execution mode (from runnable)
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
        update: (revisionId: string, changes: Partial<AppRevisionData>, options?: StoreOptions) =>
            getStore(options).set(updateAppRevisionAtom, revisionId, changes),
        discard: (revisionId: string, options?: StoreOptions) =>
            getStore(options).set(discardAppRevisionDraftAtom, revisionId),
        // Execution mode (from runnable)
        executionMode: (revisionId: string, mode: ExecutionMode, options?: StoreOptions) =>
            runnableSet.executionMode(revisionId, mode, options),
    },

    // ========================================================================
    // RUNNABLE CAPABILITY (RunnableCapability interface)
    // ========================================================================
    /**
     * Runnable capability - provides unified access to input/output ports,
     * configuration, and invocation URL.
     *
     * @example
     * ```typescript
     * const ports = useAtomValue(appRevision.runnable.inputPorts(id))
     * const config = useAtomValue(appRevision.runnable.config(id))
     * const url = useAtomValue(appRevision.runnable.invocationUrl(id))
     * ```
     */
    runnable: {
        /**
         * Input port definitions for this runnable.
         * Derived from the agConfig prompt template variables.
         */
        inputPorts: appRevisionInputPortsAtomFamily,
        /**
         * Output port definitions for this runnable.
         * Derived from the OpenAPI schema response.
         */
        outputPorts: appRevisionOutputPortsAtomFamily,
        /**
         * Configuration object (agConfig) for this runnable.
         * This is the schema that defines the runnable's parameters.
         */
        config: revisionAgConfigSchemaAtomFamily,
        /**
         * URL to invoke this runnable.
         * Depends on execution mode (draft: /test, deployed: /run).
         */
        invocationUrl: runnableAtoms.invocationUrl,
    },
}

// ============================================================================
// SELECTION CONFIG
// ============================================================================

/**
 * Pre-built selection config for entity selection system.
 * Use this with initializeSelectionSystem() to configure app revision selection.
 *
 * @example
 * ```typescript
 * import { appRevisionSelectionConfig } from '@agenta/entities/appRevision'
 *
 * initializeSelectionSystem({
 *   appRevision: appRevisionSelectionConfig,
 *   // ... other configs
 * })
 * ```
 */
export const appRevisionSelectionConfig = {
    appsAtom: appRevisionMolecule.selectors.apps,
    variantsByAppFamily: (appId: string) => appRevisionMolecule.selectors.variantsByApp(appId),
    revisionsByVariantFamily: (variantId: string) =>
        appRevisionMolecule.selectors.revisions(variantId),
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type AppRevisionMolecule = typeof appRevisionMolecule
export type AppRevisionSelectionConfig = typeof appRevisionSelectionConfig
