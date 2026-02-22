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
     * Selector atom for the parameters/configuration JSON schema.
     * This schema drives the configuration form UI (e.g. prompt settings, LLM config).
     * Separate from I/O schemas which describe the execution interface.
     */
    parametersSchemaSelector?: (id: string) => Atom<Record<string, unknown> | null>
    /**
     * Selector atom for the raw draft state (local edits not yet merged).
     * Used for hash-based change detection (e.g., URL sync).
     * If not provided, the bridge returns null for draft reads.
     */
    draftSelector?: (id: string) => Atom<unknown>
    /**
     * Invalidate all caches for this entity type.
     * Called by `runnableBridge.invalidateAllCaches()` to refresh stale data.
     */
    invalidateCache?: () => void
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
     * Selector atom for the latest revision ID given a parent entity ID (e.g., workflow ID).
     * Used by `isLatestRevision` to compare a revision against the most recent one.
     */
    latestRevisionIdSelector?: (parentId: string) => Atom<string | null>
    /**
     * Extract the parent entity ID from entity data.
     * For workflows: extracts `workflow_id`. For legacy: extracts variant/app ID.
     * Used together with `latestRevisionIdSelector` for `isLatestRevision`.
     */
    parentIdExtractor?: (entity: unknown) => string | null
    /**
     * Create a local (browser-only) draft by cloning a server revision.
     * Returns the new local draft ID, or null on failure.
     * Each entity type implements this with its own molecule/storage.
     */
    createLocalDraft?: (sourceRevisionId: string, appId?: string) => string | null
    /**
     * Selector atom for server data (before draft overlay).
     * Returns the raw entity data from the server, without any local edits merged.
     * Used for commit diff generation (comparing original vs modified).
     */
    serverDataSelector?: (id: string) => Atom<unknown | null>
    /** Additional selectors specific to this runnable type */
    extraSelectors?: Record<string, (id: string) => Atom<unknown>>
    /** Additional actions specific to this runnable type */
    extraActions?: Record<string, OpaqueWritableAtom>
    /**
     * Transform parameters before writing to the molecule.
     * Used when the bridge transforms data for display (e.g., nesting evaluator params)
     * and needs to reverse the transformation for storage.
     *
     * @param entityId - The entity being updated
     * @param params - The parameters as sent from the UI (possibly transformed for display)
     * @param get - Jotai getter to read current entity state
     * @returns Parameters in the format the molecule expects
     */
    updateTransform?: (
        entityId: string,
        params: Record<string, unknown>,
        get: (atom: Atom<unknown>) => unknown,
    ) => Record<string, unknown>
}

/**
 * Configuration for creating a runnable bridge
 */
export interface CreateRunnableBridgeConfig<
    TCrud extends RunnableBridgeCrudActions = RunnableBridgeCrudActions,
> {
    runnables: Record<string, RunnableTypeConfig>
    /** Entity-level CRUD actions to expose on the bridge */
    crud?: TCrud
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
    /** Get I/O schemas */
    schemas: (runnableId: string) => Atom<{inputSchema?: unknown; outputSchema?: unknown} | null>
    /** Get parameters/configuration JSON schema (drives config form UI) */
    parametersSchema: (runnableId: string) => Atom<Record<string, unknown> | null>
    /** Get execution mode ("chat" or "completion") */
    executionMode: (runnableId: string) => Atom<"chat" | "completion">
    /** Get pre-built request payload (config portion of API request body) */
    requestPayload: (runnableId: string) => Atom<unknown | null>
    /** Get raw draft state (local edits before merge) for change detection */
    draft: (runnableId: string) => Atom<unknown>
    /** Check if a revision is the latest for its parent entity */
    isLatestRevision: (runnableId: string) => Atom<boolean>
    /** Get server data (before draft overlay) as RunnableData */
    serverData: (runnableId: string) => Atom<RunnableData | null>
    /** Get server configuration (before draft overlay) */
    serverConfiguration: (runnableId: string) => Atom<Record<string, unknown> | null>
}

/**
 * CRUD actions exposed by the runnable bridge.
 *
 * These are entity-level actions with query invalidation baked in.
 * Playground-specific orchestration (selection, chat history, URL sync)
 * is handled via registered callbacks at the entity layer.
 */
export interface RunnableBridgeCrudActions<
    TCreateVariant = OpaqueWritableAtom,
    TCommitRevision = OpaqueWritableAtom,
    TDeleteRevision = OpaqueWritableAtom,
> {
    /** Create a new variant from a base revision */
    createVariant: TCreateVariant
    /** Commit (save) a revision to create a new version */
    commitRevision: TCommitRevision
    /** Delete a single revision */
    deleteRevision: TDeleteRevision
}

/**
 * Type-scoped selectors — only probe a single molecule type, avoiding
 * cross-contamination from shared database tables (e.g. workflow_revisions).
 */
export interface TypeScopedRunnableSelectors {
    data: (runnableId: string) => Atom<RunnableData | null>
    invocationUrl: (runnableId: string) => Atom<string | null>
    requestPayload: (runnableId: string) => Atom<unknown | null>
    executionMode: (runnableId: string) => Atom<"chat" | "completion">
    configuration: (runnableId: string) => Atom<Record<string, unknown> | null>
    inputPorts: (runnableId: string) => Atom<RunnablePort[]>
    outputPorts: (runnableId: string) => Atom<RunnablePort[]>
    schemas: (runnableId: string) => Atom<{inputSchema?: unknown; outputSchema?: unknown} | null>
    parametersSchema: (runnableId: string) => Atom<Record<string, unknown> | null>
    query: (runnableId: string) => Atom<BridgeQueryState<RunnableData>>
    isDirty: (runnableId: string) => Atom<boolean>
    draft: (runnableId: string) => Atom<unknown>
    isLatestRevision: (runnableId: string) => Atom<boolean>
    serverData: (runnableId: string) => Atom<RunnableData | null>
    serverConfiguration: (runnableId: string) => Atom<Record<string, unknown> | null>
}

/**
 * Runnable bridge interface
 *
 * Provides both nested API (selectors.*) and flattened API
 * for cleaner imports: `runnable.inputPorts(id)` instead of `runnable.selectors.inputPorts(id)`
 */
export interface RunnableBridge<
    TCrud extends RunnableBridgeCrudActions = RunnableBridgeCrudActions,
> extends RunnableBridgeSelectors {
    // Nested API (backwards compatible)
    selectors: RunnableBridgeSelectors

    /** Get runnable-type-specific controller */
    runnable: <T extends string>(
        runnableType: T,
    ) => {
        selectors: RunnableBridgeSelectors & Record<string, (id: string) => Atom<unknown>>

        actions?: Record<string, OpaqueWritableAtom>
    }

    /**
     * Get type-scoped selectors that only probe a single molecule type.
     * Use this when the entity type is known to avoid cross-type contamination.
     */
    forType: (runnableType: string) => TypeScopedRunnableSelectors

    /** Alias for configuration (capability interface compatibility) */
    config: RunnableBridgeSelectors["configuration"]
    /** Get execution mode ("chat" or "completion") */
    executionMode: RunnableBridgeSelectors["executionMode"]
    /** Get pre-built request payload (config portion of API request body) */
    requestPayload: RunnableBridgeSelectors["requestPayload"]

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
     * Entity-level CRUD actions with query invalidation baked in.
     * Playground-specific orchestration is handled via registered callbacks.
     */
    crud: TCrud

    /**
     * Update draft parameters for an entity.
     * Routes to the correct molecule's update action based on the type hint.
     */
    update: WritableAtom<unknown, [string, Record<string, unknown>], void>

    /**
     * Discard draft changes for an entity.
     * Routes to the correct molecule's discard action based on the type hint.
     */
    discard: WritableAtom<unknown, [string], void>

    /**
     * Get raw draft state for an entity (local edits before merge).
     * Used for hash-based change detection (e.g., URL sync).
     */
    draft: RunnableBridgeSelectors["draft"]

    /**
     * Invalidate all caches across all registered entity types.
     * Call this after CRUD operations to refresh stale data.
     */
    invalidateAllCaches: () => void

    /**
     * Create a local (browser-only) draft by cloning a server revision.
     * Routes to the correct entity type's createLocalDraft implementation.
     * Returns the new local draft ID, or null on failure.
     */
    createLocalDraft: (sourceRevisionId: string, appId?: string) => string | null

    /** Get server data (before draft overlay) as RunnableData */
    serverData: RunnableBridgeSelectors["serverData"]
    /** Get server configuration (before draft overlay) */
    serverConfiguration: RunnableBridgeSelectors["serverConfiguration"]
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {LoadableSourceConfig as SourceConfig, RunnableTypeConfig as RunnableConfig}
