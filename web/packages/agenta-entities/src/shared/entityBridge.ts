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
 */
export interface BaseMolecule {
    selectors: BaseMoleculeSelectors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Jotai atoms need flexible types for action registries
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
 */
export interface LoadableBridge {
    selectors: LoadableBridgeSelectors
    actions: LoadableBridgeActions
    /** Get source-specific controller for a source type */
    source: <T extends string>(
        sourceType: T,
    ) => {
        selectors: LoadableBridgeSelectors
        actions: LoadableBridgeActions
    }
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
    /** Additional selectors specific to this runnable type */
    extraSelectors?: Record<string, (id: string) => Atom<unknown>>
    /** Additional actions specific to this runnable type */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Jotai atoms need flexible types
    extraActions?: Record<string, WritableAtom<any, any[], any>>
}

/**
 * Configuration for creating a runnable bridge
 */
export interface CreateRunnableBridgeConfig {
    runnables: Record<string, RunnableTypeConfig>
}

/**
 * Runnable bridge selectors
 */
export interface RunnableBridgeSelectors {
    /** Get runnable data by ID */
    data: (runnableId: string) => Atom<RunnableData | null>
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
}

/**
 * Runnable bridge interface
 */
export interface RunnableBridge {
    selectors: RunnableBridgeSelectors
    /** Get runnable-type-specific controller */
    runnable: <T extends string>(
        runnableType: T,
    ) => {
        selectors: RunnableBridgeSelectors & Record<string, (id: string) => Atom<unknown>>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Jotai atoms need flexible types
        actions?: Record<string, WritableAtom<any, any[], any>>
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {LoadableSourceConfig as SourceConfig, RunnableTypeConfig as RunnableConfig}
