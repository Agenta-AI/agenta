/**
 * Entity Bridge Factory Implementations
 *
 * Factory functions for creating loadable and runnable bridges.
 * These bridge entity molecules to a unified controller API.
 *
 * The bridge pattern provides a consistent interface for accessing entity data
 * regardless of the underlying molecule implementation. This enables:
 * - Unified API across different entity types (testsets, traces, revisions)
 * - Static configuration at build time with runtime flexibility via context
 * - Clean separation between state management and entity specifics
 *
 * ## Important: Local-Only vs Connected Mode
 *
 * The `createLoadableBridge` factory creates bridges with **local-only** action
 * implementations. Actions like `addRow`, `updateRow`, and `removeRow` only
 * update local state and do NOT route through entity molecules.
 *
 * For production UI that needs full connected-mode support (syncing with
 * testsets, traces, etc.), use `loadableController` from `@agenta/entities/loadable`
 * instead, which properly routes actions through entity molecules.
 *
 * @see loadableController for full connected-mode support
 * @module shared/createEntityBridge
 */

import {atom, type Atom} from "jotai"
import {atomFamily} from "jotai-family"

import type {
    CreateLoadableBridgeConfig,
    CreateRunnableBridgeConfig,
    LoadableBridge,
    LoadableBridgeActions,
    LoadableBridgeSelectors,
    LoadableColumn,
    LoadableRow,
    LoadableSourceConfig as _LoadableSourceConfig,
    RunnableBridge,
    RunnableBridgeSelectors,
    RunnableData,
    RunnablePort as _RunnablePort,
    RunnableTypeConfig as _RunnableTypeConfig,
    BridgeQueryState,
} from "./entityBridge"

// ============================================================================
// LOADABLE STATE (pure atoms - no molecule dependencies)
// ============================================================================

interface LoadableState {
    rows: LoadableRow[]
    columns: LoadableColumn[]
    activeRowId: string | null
    connectedSourceId: string | null
    connectedSourceName: string | null
    connectedSourceType: string | null
    linkedRunnableType: string | null
    linkedRunnableId: string | null
    executionResults: Record<string, unknown>
}

const defaultLoadableState: LoadableState = {
    rows: [],
    columns: [],
    activeRowId: null,
    connectedSourceId: null,
    connectedSourceName: null,
    connectedSourceType: null,
    linkedRunnableType: null,
    linkedRunnableId: null,
    executionResults: {},
}

// Global loadable state atom family
const loadableStateFamily = atomFamily((_loadableId: string) =>
    atom<LoadableState>(defaultLoadableState),
)

// ============================================================================
// LOADABLE BRIDGE FACTORY
// ============================================================================

/**
 * Create a loadable bridge with configured source types.
 *
 * **Important:** This factory creates bridges with **local-only** action implementations.
 * Actions like `addRow`, `updateRow`, `removeRow` only update local state and do NOT
 * route through entity molecules when in connected mode.
 *
 * For production UI that needs full connected-mode support (syncing changes back to
 * testsets, traces, etc.), use `loadableController` from `@agenta/entities/loadable`
 * instead.
 *
 * Use this factory only for:
 * - Custom data sources that don't need entity molecule routing
 * - Local-only data manipulation (e.g., playground scratch data)
 * - Testing or prototyping
 *
 * @see loadableController for full connected-mode support with entity routing
 *
 * @example
 * ```typescript
 * // For custom local-only sources
 * const customBridge = createLoadableBridge({
 *     sources: {
 *         customSource: {
 *             molecule: customMolecule,
 *             toRow: (entity) => ({ id: entity.id, data: entity.data }),
 *         },
 *     },
 * })
 * ```
 */
export function createLoadableBridge(config: CreateLoadableBridgeConfig): LoadableBridge {
    const {sources} = config

    // Create derived atoms that bridge to molecules when connected
    const connectedRowsFamily = atomFamily((loadableId: string) =>
        atom((get) => {
            const state = get(loadableStateFamily(loadableId))

            // Not connected - return stored rows
            if (!state.connectedSourceId || !state.connectedSourceType) {
                return state.rows
            }

            // Get the source config for this connection type
            const sourceConfig = sources[state.connectedSourceType]
            if (!sourceConfig) {
                console.warn(`Unknown source type: ${state.connectedSourceType}`)
                return state.rows
            }

            // If molecule has displayRowIds, use it to get rows
            if (sourceConfig.displayRowIdsAtom) {
                const displayRowIds = get(sourceConfig.displayRowIdsAtom)
                return displayRowIds.map((id) => {
                    // Use top-level data (unified API) or fall back to selectors.data
                    const dataAtom =
                        sourceConfig.molecule.data?.(id) ?? sourceConfig.molecule.selectors.data(id)
                    const entity = get(dataAtom)
                    if (!entity) {
                        return {id, data: {}} as LoadableRow
                    }
                    return sourceConfig.toRow(entity)
                })
            }

            // Fallback to stored rows
            return state.rows
        }),
    )

    const isDirtyFamily = atomFamily((loadableId: string) =>
        atom((get) => {
            const state = get(loadableStateFamily(loadableId))

            // Not connected - check local state
            if (!state.connectedSourceId || !state.connectedSourceType) {
                return false // Local mode is never "dirty" in the save sense
            }

            // Get the source config
            const sourceConfig = sources[state.connectedSourceType]
            if (!sourceConfig || !sourceConfig.hasUnsavedChangesAtom) {
                return false
            }

            return get(sourceConfig.hasUnsavedChangesAtom)
        }),
    )

    // Create selectors
    const selectors: LoadableBridgeSelectors = {
        rows: (loadableId: string) => connectedRowsFamily(loadableId),

        columns: (loadableId: string) =>
            atom((get) => get(loadableStateFamily(loadableId)).columns),

        allColumns: (loadableId: string) =>
            atom((get) => {
                const state = get(loadableStateFamily(loadableId))
                const rows = get(connectedRowsFamily(loadableId))

                if (rows.length === 0) return state.columns

                const keySet = new Set<string>()
                rows.forEach((row) => {
                    Object.keys(row.data).forEach((key) => keySet.add(key))
                })
                return Array.from(keySet).map((key) => ({
                    key,
                    name: key,
                    type: "string" as const,
                }))
            }),

        activeRow: (loadableId: string) =>
            atom((get) => {
                const state = get(loadableStateFamily(loadableId))
                const rows = get(connectedRowsFamily(loadableId))

                if (!state.activeRowId && rows.length > 0) {
                    return rows[0]
                }
                return rows.find((r) => r.id === state.activeRowId) ?? null
            }),

        rowCount: (loadableId: string) =>
            atom((get) => get(connectedRowsFamily(loadableId)).length),

        mode: (loadableId: string) =>
            atom((get) => {
                const state = get(loadableStateFamily(loadableId))
                return state.connectedSourceId ? ("connected" as const) : ("local" as const)
            }),

        isDirty: (loadableId: string) => isDirtyFamily(loadableId),

        hasLocalChanges: (loadableId: string) =>
            atom((get) => {
                const state = get(loadableStateFamily(loadableId))
                // In connected mode, delegate to molecule
                if (state.connectedSourceId && state.connectedSourceType) {
                    return get(isDirtyFamily(loadableId))
                }
                // In local mode, always false (nothing to save to)
                return false
            }),

        connectedSource: (loadableId: string) =>
            atom((get) => {
                const state = get(loadableStateFamily(loadableId))
                return {
                    id: state.connectedSourceId,
                    name: state.connectedSourceName,
                }
            }),

        executionResults: (loadableId: string) =>
            atom((get) => get(loadableStateFamily(loadableId)).executionResults),

        supportsDynamicInputs: (loadableId: string) =>
            atom((get) => {
                const state = get(loadableStateFamily(loadableId))
                // Local mode supports dynamic inputs
                if (!state.connectedSourceId) return true
                // Connected mode - depends on source type
                // Testsets support dynamic inputs, traces typically don't
                return state.connectedSourceType === "testcase"
            }),
    }

    // Create actions
    const actions: LoadableBridgeActions = {
        addRow: atom(null, (get, set, loadableId: string, data: Record<string, unknown> = {}) => {
            const state = get(loadableStateFamily(loadableId))

            const newRow: LoadableRow = {
                id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                data,
            }

            set(loadableStateFamily(loadableId), {
                ...state,
                rows: [...state.rows, newRow],
            })
        }),

        updateRow: atom(
            null,
            (get, set, loadableId: string, rowId: string, data: Record<string, unknown>) => {
                const state = get(loadableStateFamily(loadableId))

                set(loadableStateFamily(loadableId), {
                    ...state,
                    rows: state.rows.map((row) =>
                        row.id === rowId ? {...row, data: {...row.data, ...data}} : row,
                    ),
                })
            },
        ),

        removeRow: atom(null, (get, set, loadableId: string, rowId: string) => {
            const state = get(loadableStateFamily(loadableId))

            set(loadableStateFamily(loadableId), {
                ...state,
                rows: state.rows.filter((row) => row.id !== rowId),
            })
        }),

        setActiveRow: atom(null, (get, set, loadableId: string, rowId: string | null) => {
            const state = get(loadableStateFamily(loadableId))
            set(loadableStateFamily(loadableId), {
                ...state,
                activeRowId: rowId,
            })
        }),

        setRows: atom(null, (get, set, loadableId: string, rows: LoadableRow[]) => {
            const state = get(loadableStateFamily(loadableId))
            set(loadableStateFamily(loadableId), {
                ...state,
                rows,
            })
        }),

        setColumns: atom(null, (get, set, loadableId: string, columns: LoadableColumn[]) => {
            const state = get(loadableStateFamily(loadableId))
            set(loadableStateFamily(loadableId), {
                ...state,
                columns,
            })
        }),

        connectToSource: atom(
            null,
            (
                get,
                set,
                loadableId: string,
                sourceId: string,
                sourceName: string,
                sourceType: string,
            ) => {
                const state = get(loadableStateFamily(loadableId))
                set(loadableStateFamily(loadableId), {
                    ...state,
                    connectedSourceId: sourceId,
                    connectedSourceName: sourceName,
                    connectedSourceType: sourceType,
                    // Clear local rows when connecting
                    rows: [],
                })
            },
        ),

        disconnect: atom(null, (get, set, loadableId: string) => {
            const state = get(loadableStateFamily(loadableId))
            // Optionally preserve rows when disconnecting
            const currentRows = get(connectedRowsFamily(loadableId))

            set(loadableStateFamily(loadableId), {
                ...state,
                connectedSourceId: null,
                connectedSourceName: null,
                connectedSourceType: null,
                rows: currentRows, // Keep rows as local data
            })
        }),

        linkToRunnable: atom(
            null,
            (get, set, loadableId: string, runnableType: string, runnableId: string) => {
                const state = get(loadableStateFamily(loadableId))
                set(loadableStateFamily(loadableId), {
                    ...state,
                    linkedRunnableType: runnableType,
                    linkedRunnableId: runnableId,
                })
            },
        ),

        unlinkRunnable: atom(null, (get, set, loadableId: string) => {
            const state = get(loadableStateFamily(loadableId))
            set(loadableStateFamily(loadableId), {
                ...state,
                linkedRunnableType: null,
                linkedRunnableId: null,
            })
        }),

        setExecutionResult: atom(
            null,
            (get, set, loadableId: string, rowId: string, result: unknown) => {
                const state = get(loadableStateFamily(loadableId))
                set(loadableStateFamily(loadableId), {
                    ...state,
                    executionResults: {
                        ...state.executionResults,
                        [rowId]: result,
                    },
                })
            },
        ),

        clearExecutionResults: atom(null, (get, set, loadableId: string) => {
            const state = get(loadableStateFamily(loadableId))
            set(loadableStateFamily(loadableId), {
                ...state,
                executionResults: {},
            })
        }),

        save: atom(null, async (_get, _set, _loadableId: string) => {
            console.warn("save not yet implemented")
        }),

        discard: atom(null, (_get, _set, _loadableId: string) => {
            console.warn("discard not yet implemented")
        }),
    }

    return {
        // Nested API (backwards compatible)
        selectors,
        actions,
        source: <T extends string>(_sourceType: T) => ({
            selectors,
            actions,
        }),

        // =====================================================================
        // FLATTENED API (preferred)
        // These are top-level aliases for cleaner imports:
        //   loadable.rows(id) instead of loadable.selectors.rows(id)
        // =====================================================================

        /** Get all rows for a loadable */
        rows: selectors.rows,
        /** Get column definitions */
        columns: selectors.columns,
        /** Get all columns from data */
        allColumns: selectors.allColumns,
        /** Get the active/selected row */
        activeRow: selectors.activeRow,
        /** Get row count */
        rowCount: selectors.rowCount,
        /** Get mode (local or connected) */
        mode: selectors.mode,
        /** Check if loadable has unsaved changes */
        isDirty: selectors.isDirty,
        /** Check if loadable has local changes */
        hasLocalChanges: selectors.hasLocalChanges,
        /** Alias for isDirty (capability interface compatibility) */
        hasChanges: selectors.isDirty,
        /** Get connected source info */
        connectedSource: selectors.connectedSource,
        /** Get execution results */
        executionResults: selectors.executionResults,
        /** Check if source supports dynamic inputs */
        supportsDynamicInputs: selectors.supportsDynamicInputs,

        // Flattened actions
        /** Add a row to the loadable */
        addRow: actions.addRow,
        /** Update a row */
        updateRow: actions.updateRow,
        /** Remove a row */
        removeRow: actions.removeRow,
        /** Set the active row */
        setActiveRow: actions.setActiveRow,
        /** Set all rows (bulk update) */
        setRows: actions.setRows,
        /** Set columns */
        setColumns: actions.setColumns,
        /** Connect to a data source */
        connectToSource: actions.connectToSource,
        /** Disconnect from source (switch to local mode) */
        disconnect: actions.disconnect,
        /** Link to a runnable (for column derivation) */
        linkToRunnable: actions.linkToRunnable,
        /** Unlink from runnable */
        unlinkRunnable: actions.unlinkRunnable,
        /** Set execution result for a row */
        setExecutionResult: actions.setExecutionResult,
        /** Clear execution results */
        clearExecutionResults: actions.clearExecutionResults,
        /** Save changes (when connected) */
        save: actions.save,
        /** Discard changes (when connected) */
        discard: actions.discard,
    }
}

// ============================================================================
// RUNNABLE BRIDGE FACTORY
// ============================================================================

/**
 * Create a runnable bridge with configured runnable types
 *
 * @example
 * ```typescript
 * const runnableBridge = createRunnableBridge({
 *     runnables: {
 *         appRevision: {
 *             molecule: appRevisionMolecule,
 *             toRunnable: (entity) => ({ id: entity.id, ... }),
 *             getInputPorts: (entity) => extractInputPorts(entity.schemas?.inputSchema),
 *             getOutputPorts: (entity) => extractOutputPorts(entity.schemas?.outputSchema),
 *         },
 *         evaluatorRevision: {
 *             molecule: evaluatorRevisionMolecule,
 *             toRunnable: (entity) => ({ id: entity.id, ... }),
 *             getInputPorts: (entity) => extractInputPorts(entity.schemas?.inputSchema),
 *             getOutputPorts: (entity) => [{key: 'score', name: 'Score', type: 'number'}],
 *             extraSelectors: {
 *                 presets: (id) => evaluatorRevisionMolecule.selectors.presets(id),
 *             },
 *         },
 *     },
 * })
 * ```
 */
export function createRunnableBridge(config: CreateRunnableBridgeConfig): RunnableBridge {
    const {runnables} = config

    // Create selectors
    const selectors: RunnableBridgeSelectors = {
        data: (runnableId: string) =>
            atom((get) => {
                // Try each runnable type to find data
                for (const [_type, config] of Object.entries(runnables)) {
                    const entity = get(config.molecule.selectors.data(runnableId))
                    if (entity) {
                        return config.toRunnable(entity)
                    }
                }
                return null
            }),

        query: (runnableId: string) =>
            atom((get) => {
                // Try each runnable type to find query state
                for (const [_type, config] of Object.entries(runnables)) {
                    const query = get(config.molecule.selectors.query(runnableId))
                    if (query.data || query.isPending || query.isError) {
                        return query as BridgeQueryState<RunnableData>
                    }
                }
                return {
                    data: null,
                    isPending: false,
                    isError: false,
                    error: null,
                }
            }),

        isDirty: (runnableId: string) =>
            atom((get) => {
                for (const [_type, config] of Object.entries(runnables)) {
                    const isDirty = get(config.molecule.selectors.isDirty(runnableId))
                    if (isDirty) return true
                }
                return false
            }),

        inputPorts: (runnableId: string) =>
            atom((get) => {
                for (const [_type, config] of Object.entries(runnables)) {
                    const entity = get(config.molecule.selectors.data(runnableId))
                    if (entity) {
                        // Prefer selector atom if provided (reactive derivation)
                        if (config.inputPortsSelector) {
                            return get(config.inputPortsSelector(runnableId))
                        }
                        // Fallback to extraction function
                        return config.getInputPorts(entity)
                    }
                }
                return []
            }),

        outputPorts: (runnableId: string) =>
            atom((get) => {
                for (const [_type, config] of Object.entries(runnables)) {
                    const entity = get(config.molecule.selectors.data(runnableId))
                    if (entity) {
                        // Prefer selector atom if provided (reactive derivation)
                        if (config.outputPortsSelector) {
                            return get(config.outputPortsSelector(runnableId))
                        }
                        // Fallback to extraction function
                        return config.getOutputPorts(entity)
                    }
                }
                return []
            }),

        configuration: (runnableId: string) =>
            atom((get) => {
                const data = get(selectors.data(runnableId))
                return data?.configuration ?? null
            }),

        invocationUrl: (runnableId: string) =>
            atom((get) => {
                // Try each runnable type to find invocation URL
                for (const [_type, config] of Object.entries(runnables)) {
                    const entity = get(config.molecule.selectors.data(runnableId))
                    if (entity) {
                        // Prefer selector atom if provided (computed from schema)
                        if (config.invocationUrlSelector) {
                            return get(config.invocationUrlSelector(runnableId))
                        }
                        // Fallback to toRunnable extraction
                        const data = config.toRunnable(entity)
                        return data?.invocationUrl ?? null
                    }
                }
                return null
            }),

        schemas: (runnableId: string) =>
            atom((get) => {
                const data = get(selectors.data(runnableId))
                return data?.schemas ?? null
            }),
    }

    return {
        // Nested API (backwards compatible)
        selectors,
        runnable: <T extends string>(runnableType: T) => {
            const config = runnables[runnableType]
            if (!config) {
                throw new Error(`Unknown runnable type: ${runnableType}`)
            }

            return {
                selectors: {
                    ...selectors,
                    ...config.extraSelectors,
                } as RunnableBridgeSelectors & Record<string, (id: string) => Atom<unknown>>,
                actions: config.extraActions,
            }
        },

        // =====================================================================
        // FLATTENED API (preferred)
        // These are top-level aliases for cleaner imports:
        //   runnable.inputPorts(id) instead of runnable.selectors.inputPorts(id)
        // =====================================================================

        /** Get runnable data by ID */
        data: selectors.data,
        /** Get query state */
        query: selectors.query,
        /** Check if runnable has unsaved changes */
        isDirty: selectors.isDirty,
        /** Get input ports */
        inputPorts: selectors.inputPorts,
        /** Get output ports */
        outputPorts: selectors.outputPorts,
        /** Get configuration */
        configuration: selectors.configuration,
        /** Alias for configuration (capability interface compatibility) */
        config: selectors.configuration,
        /** Get invocation URL */
        invocationUrl: selectors.invocationUrl,
        /** Get schemas */
        schemas: selectors.schemas,
    }
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Get the internal loadable state family (for advanced usage)
 */
export {loadableStateFamily}
