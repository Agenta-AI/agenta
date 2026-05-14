/**
 * Entity Bridge Type Definitions
 *
 * Type definitions for the loadable bridge pattern and shared entity types.
 * Bridges provide unified controller interfaces for loadable entities,
 * enabling consistent access patterns across different data source types.
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
 * Opaque writable atom type for pass-through maps where action signatures vary.
 * Use concrete WritableAtom generics only at invocation sites.
 */
export interface OpaqueWritableAtom {
    read: unknown
    write: unknown
    onMount?: unknown
    debugLabel?: string
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

    actions: {
        /** Update entity draft */
        update: OpaqueWritableAtom
        /** Discard entity draft */
        discard: OpaqueWritableAtom
        [key: string]: OpaqueWritableAtom
    }
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
// STANDALONE ENTITY TYPES
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
    /**
     * Optional plain-language description of what this port represents,
     * surfaced as the info-tooltip next to the variable header. Should be
     * authored for end users (SMEs), not engineers — explain *what data this
     * holds* and *how to reference it in the prompt template*.
     */
    helpText?: string
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {LoadableSourceConfig as SourceConfig}
