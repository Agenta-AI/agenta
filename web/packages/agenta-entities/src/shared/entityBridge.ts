/**
 * Entity Bridge Type Definitions
 *
 * Type definitions for the entity bridge pattern. Bridges provide unified
 * controller interfaces for loadable and runnable entities, enabling consistent
 * access patterns across different entity types.
 *
 * ## Bridge Pattern Overview
 *
 * The bridge pattern separates:
 * - **Pure state atoms**: No entity dependencies, live in store.ts
 * - **Entity bridges**: Connect molecule APIs to unified selectors/actions
 * - **Controller**: Combines state + bridge into a usable API
 *
 * ## Loadable Bridge
 *
 * For data sources that provide inputs to runnables (testsets, traces, etc.):
 * ```typescript
 * const loadableBridge = createLoadableBridge({
 *     sources: {
 *         testcase: { molecule: testcaseMolecule, toRow: (entity) => ({...}) },
 *         trace: { molecule: traceSpanMolecule, toRow: (entity) => ({...}) },
 *     },
 * })
 *
 * const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))
 * ```
 *
 * ## Runnable Bridge
 *
 * For executables that can be invoked (app revisions, evaluator revisions):
 * ```typescript
 * const runnableBridge = createRunnableBridge({
 *     runnables: {
 *         appRevision: { molecule: appRevisionMolecule, ... },
 *         evaluatorRevision: { molecule: evaluatorRevisionMolecule, ... },
 *     },
 * })
 *
 * const data = useAtomValue(runnableBridge.selectors.data(runnableId))
 * ```
 *
 * @module shared/entityBridge
 */

import type {Atom, WritableAtom} from "jotai"

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Query state for entity data
 */
export interface BridgeQueryState<T = unknown> {
    data: T | null
    isPending: boolean
    isError: boolean
    error: unknown
}

/**
 * Base molecule interface that all entities must implement
 */
export interface BaseMoleculeSelectors {
    /** Get entity data by ID */
    data: (id: string) => Atom<unknown | null>
    /** Get query state by ID */
    query: (id: string) => Atom<BridgeQueryState>
    /** Check if entity has unsaved changes */
    isDirty: (id: string) => Atom<boolean>
}

/**
 * Base molecule interface
 *
 * Molecules provide both:
 * - Top-level API (preferred): `molecule.data(id)`, `molecule.query(id)`, `molecule.isDirty(id)`
 * - Nested selectors (backwards compatible): `molecule.selectors.data(id)`
 */
export interface BaseMolecule {
    // Top-level API (preferred - unified API)
    /** Get entity data by ID (top-level alias) */
    data?: (id: string) => Atom<unknown | null>
    /** Get query state by ID (top-level alias) */
    query?: (id: string) => Atom<BridgeQueryState>
    /** Check if entity has unsaved changes (top-level alias) */
    isDirty?: (id: string) => Atom<boolean>

    // Nested API (backwards compatible)
    selectors: BaseMoleculeSelectors

    actions?: Record<string, WritableAtom<any, any[], any>>
}

// ============================================================================
// LOADABLE BRIDGE TYPES
// ============================================================================

/**
 * Row format for loadable data sources
 */
export interface LoadableRow {
    id: string
    data: Record<string, unknown>
}

/**
 * Column definition for loadable data
 */
export interface LoadableColumn {
    key: string
    name: string
    type: "string" | "number" | "boolean" | "object" | "array"
}

/**
 * Configuration for a loadable source type
 */
export interface LoadableSourceConfig<T = unknown> {
    /** The molecule to use for this source type */
    molecule: BaseMolecule
    /** Transform entity data to row format */
    toRow: (entity: T) => LoadableRow
    /** Transform row data back to entity format (for mutations) */
    fromRow?: (row: LoadableRow) => Partial<T>
    /** Get display row IDs atom from molecule */
    displayRowIdsAtom?: Atom<string[]>
    /** Check if molecule has unsaved changes */
    hasUnsavedChangesAtom?: Atom<boolean>
}

/**
 * Configuration for creating a loadable bridge
 */
export interface CreateLoadableBridgeConfig {
    sources: Record<string, LoadableSourceConfig>
}

/**
 * Loadable bridge selectors
 */
export interface LoadableBridgeSelectors {
    /** Get all rows for a loadable */
    rows: (loadableId: string) => Atom<LoadableRow[]>
    /** Get column definitions */
    columns: (loadableId: string) => Atom<LoadableColumn[]>
    /** Get all columns from data */
    allColumns: (loadableId: string) => Atom<LoadableColumn[]>
    /** Get the active/selected row */
    activeRow: (loadableId: string) => Atom<LoadableRow | null>
    /** Get row count */
    rowCount: (loadableId: string) => Atom<number>
    /** Get mode (local or connected) */
    mode: (loadableId: string) => Atom<"local" | "connected">
    /** Check if loadable has unsaved changes */
    isDirty: (loadableId: string) => Atom<boolean>
    /** Check if loadable has local changes */
    hasLocalChanges: (loadableId: string) => Atom<boolean>
    /** Get connected source info */
    connectedSource: (loadableId: string) => Atom<{id: string | null; name: string | null}>
    /** Get execution results */
    executionResults: (loadableId: string) => Atom<Record<string, unknown>>
    /** Check if source supports dynamic inputs */
    supportsDynamicInputs: (loadableId: string) => Atom<boolean>
}

/**
 * Loadable bridge actions
 */
export interface LoadableBridgeActions {
    /** Add a row to the loadable */
    addRow: WritableAtom<null, [loadableId: string, data?: Record<string, unknown>], void>
    /** Update a row */
    updateRow: WritableAtom<
        null,
        [loadableId: string, rowId: string, data: Record<string, unknown>],
        void
    >
    /** Remove a row */
    removeRow: WritableAtom<null, [loadableId: string, rowId: string], void>
    /** Set the active row */
    setActiveRow: WritableAtom<null, [loadableId: string, rowId: string | null], void>
    /** Set all rows (bulk update) */
    setRows: WritableAtom<null, [loadableId: string, rows: LoadableRow[]], void>
    /** Set columns */
    setColumns: WritableAtom<null, [loadableId: string, columns: LoadableColumn[]], void>
    /** Connect to a data source */
    connectToSource: WritableAtom<
        null,
        [loadableId: string, sourceId: string, sourceName: string, sourceType: string],
        void
    >
    /** Disconnect from source (switch to local mode) */
    disconnect: WritableAtom<null, [loadableId: string], void>
    /** Link to a runnable (for column derivation) */
    linkToRunnable: WritableAtom<
        null,
        [loadableId: string, runnableType: string, runnableId: string],
        void
    >
    /** Unlink from runnable */
    unlinkRunnable: WritableAtom<null, [loadableId: string], void>
    /** Set execution result for a row */
    setExecutionResult: WritableAtom<
        null,
        [loadableId: string, rowId: string, result: unknown],
        void
    >
    /** Clear execution results */
    clearExecutionResults: WritableAtom<null, [loadableId: string], void>
    /** Save changes (when connected) */
    save: WritableAtom<null, [loadableId: string], Promise<void>>
    /** Discard changes (when connected) */
    discard: WritableAtom<null, [loadableId: string], void>
}

/**
 * Loadable bridge interface
 *
 * Provides both nested API (selectors.*, actions.*) and flattened API
 * for cleaner imports: `loadable.rows(id)` instead of `loadable.selectors.rows(id)`
 */
export interface LoadableBridge extends LoadableBridgeSelectors {
    // Nested API (backwards compatible)
    selectors: LoadableBridgeSelectors
    actions: LoadableBridgeActions

    /** Get source-specific controller for a source type */
    source: <T extends string>(
        sourceType: T,
    ) => {
        selectors: LoadableBridgeSelectors
        actions: LoadableBridgeActions
    }

    // Flattened actions (top-level aliases)
    /** Add a row to the loadable */
    addRow: LoadableBridgeActions["addRow"]
    /** Update a row */
    updateRow: LoadableBridgeActions["updateRow"]
    /** Remove a row */
    removeRow: LoadableBridgeActions["removeRow"]
    /** Set the active row */
    setActiveRow: LoadableBridgeActions["setActiveRow"]
    /** Set all rows (bulk update) */
    setRows: LoadableBridgeActions["setRows"]
    /** Set columns */
    setColumns: LoadableBridgeActions["setColumns"]
    /** Connect to a data source */
    connectToSource: LoadableBridgeActions["connectToSource"]
    /** Disconnect from source (switch to local mode) */
    disconnect: LoadableBridgeActions["disconnect"]
    /** Link to a runnable (for column derivation) */
    linkToRunnable: LoadableBridgeActions["linkToRunnable"]
    /** Unlink from runnable */
    unlinkRunnable: LoadableBridgeActions["unlinkRunnable"]
    /** Set execution result for a row */
    setExecutionResult: LoadableBridgeActions["setExecutionResult"]
    /** Clear execution results */
    clearExecutionResults: LoadableBridgeActions["clearExecutionResults"]
    /** Save changes (when connected) */
    save: LoadableBridgeActions["save"]
    /** Discard changes (when connected) */
    discard: LoadableBridgeActions["discard"]

    /** Alias for isDirty (capability interface compatibility) */
    hasChanges: LoadableBridgeSelectors["isDirty"]
}

// ============================================================================
// RUNNABLE BRIDGE TYPES
// ============================================================================

/**
 * Input/output port for runnables
 */
export interface RunnablePort {
    key: string
    name: string
    type: string
    required?: boolean
    schema?: unknown
}

/**
 * Runnable data interface
 */
export interface RunnableData {
    id: string
    name?: string
    version?: number
    slug?: string
    configuration?: Record<string, unknown>
    invocationUrl?: string
    /** Entity URI (e.g., "agenta:builtin:auto_exact_match:v0" for evaluators) */
    uri?: string
    schemas?: {
        inputSchema?: unknown
        outputSchema?: unknown
    }
}

/**
 * Configuration for a runnable type
 */
export interface RunnableTypeConfig<T = unknown> {
    /** The molecule to use for this runnable type */
    molecule: BaseMolecule
    /** Transform molecule data to runnable format */
    toRunnable: (entity: T) => RunnableData
    /** Extract input ports from entity (fallback if inputPortsSelector not provided) */
    getInputPorts: (entity: T) => RunnablePort[]
    /** Extract output ports from entity (fallback if outputPortsSelector not provided) */
    getOutputPorts: (entity: T) => RunnablePort[]
    /**
     * Selector atom for runnable schemas ({inputSchema, outputSchema}).
     * Use this when schemas are derived from entity-level schema atoms
     * instead of being embedded on entity data.
     */
    schemasSelector?: (id: string) => Atom<{inputSchema?: unknown; outputSchema?: unknown} | null>
    /**
     * Selector atom for input ports (preferred over getInputPorts).
     * Use this when input ports are derived reactively from entity state.
     */
    inputPortsSelector?: (id: string) => Atom<RunnablePort[]>
    /**
     * Selector atom for output ports (preferred over getOutputPorts).
     * Use this when output ports are derived reactively from entity state.
     */
    outputPortsSelector?: (id: string) => Atom<RunnablePort[]>
    /**
     * Selector atom for invocation URL (preferred over toRunnable.invocationUrl).
     * Use this when invocation URL is computed from schema/other atoms.
     */
    invocationUrlSelector?: (id: string) => Atom<string | null>
    /**
     * Selector atom for execution mode ("chat" | "completion").
     * Derived from schema (e.g. presence of messagesSchema → "chat").
     */
    executionModeSelector?: (id: string) => Atom<"chat" | "completion">
    /**
     * Selector atom for request payload (pre-built config portion of API request).
     * Each entity type implements this to build ag_config from its own molecule data.
     * Returns null when entity data is not yet available.
     */
    requestPayloadSelector?: (id: string) => Atom<unknown | null>
    /**
     * Selector atom for global metadata store.
     * Returns all property metadata entries. Not entity-scoped — metadata is shared.
     * Only legacyAppRevision provides this (via metadataAtom).
     */
    metadataSelector?: () => Atom<Record<string, Record<string, unknown>>>
    /**
     * Normalize a raw API response into a standard shape.
     * Each entity type can define how its response should be parsed.
     * When not provided, the default parsing in executeViaFetch is used.
     *
     * @returns `{output, trace}` where output is the meaningful payload
     *          and trace is optional trace metadata.
     */
    normalizeResponse?: (responseData: unknown) => {
        output: unknown
        trace?: {id: string} | undefined
    }
    /**
     * Imperative utility functions for value extraction and message construction.
     * Only needed for entity types with enhanced PropertyNode values (legacyAppRevision).
     */
    utils?: RunnableExecutionUtils
    /** Additional selectors specific to this runnable type */
    extraSelectors?: Record<string, (id: string) => Atom<unknown>>
    /** Additional actions specific to this runnable type */

    extraActions?: Record<string, WritableAtom<any, any[], any>>
}

/**
 * Configuration for creating a runnable bridge
 */
export interface CreateRunnableBridgeConfig {
    runnables: Record<string, RunnableTypeConfig>
    /** Entity-level CRUD actions to expose on the bridge */
    crud?: RunnableBridgeCrudActions
}

/**
 * Runnable bridge selectors
 */
export interface RunnableBridgeSelectors {
    /** Get runnable data by ID (probes all registered molecule types) */
    data: (runnableId: string) => Atom<RunnableData | null>
    /** Get runnable data by type + ID (queries only the specified molecule) */
    dataForType: (runnableType: string, runnableId: string) => Atom<RunnableData | null>
    /** Get query state */
    query: (runnableId: string) => Atom<BridgeQueryState<RunnableData>>
    /** Check if runnable has unsaved changes */
    isDirty: (runnableId: string) => Atom<boolean>
    /** Get input ports */
    inputPorts: (runnableId: string) => Atom<RunnablePort[]>
    /** Get output ports */
    outputPorts: (runnableId: string) => Atom<RunnablePort[]>
    /** Get configuration */
    configuration: (runnableId: string) => Atom<Record<string, unknown> | null>
    /** Get invocation URL */
    invocationUrl: (runnableId: string) => Atom<string | null>
    /** Get schemas */
    schemas: (runnableId: string) => Atom<{inputSchema?: unknown; outputSchema?: unknown} | null>
    /** Get execution mode ("chat" or "completion") */
    executionMode: (runnableId: string) => Atom<"chat" | "completion">
    /** Get pre-built request payload (config portion of API request body) */
    requestPayload: (runnableId: string) => Atom<unknown | null>
    /** Get global metadata store (all property metadata entries) */
    metadata: () => Atom<Record<string, Record<string, unknown>>>
}

/**
 * Imperative utility functions for entity-specific value extraction and
 * message construction. Provided by a registered runnable type (e.g. legacyAppRevision).
 */
export interface RunnableExecutionUtils {
    /** Extract raw value from enhanced PropertyNode using metadata */

    extractValueByMetadata: (enhanced: any, allMetadata: any, debug?: boolean) => unknown
    /** Get all metadata (imperative, includes pending writes) */
    getAllMetadata: () => Record<string, unknown>
    /** Create a message PropertyNode from schema metadata */

    createMessageFromSchema: (metadata: any, json?: Record<string, unknown>) => any
    /** Get a specific metadata entry by hash */
    getMetadataLazy?: (hash: string) => unknown
}

/**
 * CRUD actions exposed by the runnable bridge.
 *
 * These are entity-level actions with query invalidation baked in.
 * Playground-specific orchestration (selection, chat history, URL sync)
 * is handled via registered callbacks at the entity layer.
 */
export interface RunnableBridgeCrudActions {
    /** Create a new variant from a base revision */

    createVariant: WritableAtom<any, any[], any>
    /** Commit (save) a revision to create a new version */

    commitRevision: WritableAtom<any, any[], any>
    /** Delete a single revision */

    deleteRevision: WritableAtom<any, any[], any>
}

/**
 * Runnable bridge interface
 *
 * Provides both nested API (selectors.*) and flattened API
 * for cleaner imports: `runnable.inputPorts(id)` instead of `runnable.selectors.inputPorts(id)`
 */
export interface RunnableBridge extends RunnableBridgeSelectors {
    // Nested API (backwards compatible)
    selectors: RunnableBridgeSelectors

    /** Get runnable-type-specific controller */
    runnable: <T extends string>(
        runnableType: T,
    ) => {
        selectors: RunnableBridgeSelectors & Record<string, (id: string) => Atom<unknown>>

        actions?: Record<string, WritableAtom<any, any[], any>>
    }

    /** Alias for configuration (capability interface compatibility) */
    config: RunnableBridgeSelectors["configuration"]
    /** Get execution mode ("chat" or "completion") */
    executionMode: RunnableBridgeSelectors["executionMode"]
    /** Get pre-built request payload (config portion of API request body) */
    requestPayload: RunnableBridgeSelectors["requestPayload"]
    /** Get global metadata store (all property metadata entries) */
    metadata: RunnableBridgeSelectors["metadata"]

    /**
     * Normalize a raw API response for a given runnableId.
     * Delegates to the matching entity type's `normalizeResponse` if defined,
     * otherwise applies default parsing (unwrap `data` field, extract `trace_id`).
     */
    normalizeResponse: (
        runnableId: string,
        responseData: unknown,
    ) => {output: unknown; trace?: {id: string} | undefined}

    /**
     * Imperative utility functions for value extraction and message construction.
     * Provided by the first registered runnable type that supplies `utils`.
     * Returns null if no runnable type provides utils.
     */
    utils: RunnableExecutionUtils | null

    /**
     * Entity-level CRUD actions with query invalidation baked in.
     * Playground-specific orchestration is handled via registered callbacks.
     */
    crud: RunnableBridgeCrudActions
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {LoadableSourceConfig as SourceConfig, RunnableTypeConfig as RunnableConfig}
