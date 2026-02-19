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
import {getDefaultStore} from "jotai/vanilla"
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
    RunnableBridgeCrudActions,
    RunnableBridgeSelectors,
    RunnableData,
    RunnablePort as _RunnablePort,
    RunnableTypeConfig as _RunnableTypeConfig,
    TypeScopedRunnableSelectors,
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
/**
 * Type hint registry for runnable IDs.
 *
 * When a runnable ID has a registered type hint, bridge selectors skip probing
 * other molecule types and go directly to the hinted type's molecule. This
 * prevents spurious API calls (e.g., querying the legacy API for workflow IDs).
 *
 * The playground registers hints when nodes are created/updated.
 */
const _runnableTypeHints = new Map<string, string>()

/** Register a type hint for a runnable ID */
export function registerRunnableTypeHint(id: string, type: string): void {
    _runnableTypeHints.set(id, type)
}

/** Clear a type hint for a runnable ID */
export function clearRunnableTypeHint(id: string): void {
    _runnableTypeHints.delete(id)
}

/** Clear all type hints (for cleanup) */
export function clearAllRunnableTypeHints(): void {
    _runnableTypeHints.clear()
}

export function createRunnableBridge(config: CreateRunnableBridgeConfig): RunnableBridge {
    const {runnables, crud} = config

    /**
     * Helper: resolve the runnable config for a given ID.
     * If a type hint exists, return only that config. Otherwise return null
     * to indicate the caller should probe all types.
     */
    const getHintedConfig = (runnableId: string) => {
        const hintedType = _runnableTypeHints.get(runnableId)
        if (hintedType && runnables[hintedType]) {
            return {type: hintedType, config: runnables[hintedType]}
        }
        return null
    }

    // Atom families for stable references — each selector returns the SAME atom
    // instance for the same runnableId across renders.
    const dataFamily = atomFamily((runnableId: string) =>
        atom((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                const entity = get(hinted.config.molecule.selectors.data(runnableId))
                return entity ? hinted.config.toRunnable(entity) : null
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = get(config.molecule.selectors.data(runnableId))
                if (entity) {
                    return config.toRunnable(entity)
                }
            }
            return null
        }),
    )

    const dataForTypeFamily = atomFamily(
        ({runnableType, runnableId}: {runnableType: string; runnableId: string}) =>
            atom((get) => {
                const config = runnables[runnableType]
                if (!config) return null
                const entity = get(config.molecule.selectors.data(runnableId))
                if (!entity) return null
                return config.toRunnable(entity)
            }),
        (a, b) => a.runnableType === b.runnableType && a.runnableId === b.runnableId,
    )

    const queryFamily = atomFamily((runnableId: string) =>
        atom((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                const query = get(hinted.config.molecule.selectors.query(runnableId))
                return query as BridgeQueryState<RunnableData>
            }
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
    )

    const isDirtyFamily = atomFamily((runnableId: string) =>
        atom((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                return get(hinted.config.molecule.selectors.isDirty(runnableId))
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const isDirty = get(config.molecule.selectors.isDirty(runnableId))
                if (isDirty) return true
            }
            return false
        }),
    )

    const inputPortsFamily = atomFamily((runnableId: string) =>
        atom((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                const entity = get(hinted.config.molecule.selectors.data(runnableId))
                if (!entity) return []
                if (hinted.config.inputPortsSelector) {
                    return get(hinted.config.inputPortsSelector(runnableId))
                }
                return hinted.config.getInputPorts(entity)
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = get(config.molecule.selectors.data(runnableId))
                if (entity) {
                    if (config.inputPortsSelector) {
                        return get(config.inputPortsSelector(runnableId))
                    }
                    return config.getInputPorts(entity)
                }
            }
            return []
        }),
    )

    const outputPortsFamily = atomFamily((runnableId: string) =>
        atom((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                const entity = get(hinted.config.molecule.selectors.data(runnableId))
                if (!entity) return []
                if (hinted.config.outputPortsSelector) {
                    return get(hinted.config.outputPortsSelector(runnableId))
                }
                return hinted.config.getOutputPorts(entity)
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = get(config.molecule.selectors.data(runnableId))
                if (entity) {
                    if (config.outputPortsSelector) {
                        return get(config.outputPortsSelector(runnableId))
                    }
                    return config.getOutputPorts(entity)
                }
            }
            return []
        }),
    )

    const configurationFamily = atomFamily((runnableId: string) =>
        atom((get) => {
            const data = get(dataFamily(runnableId))
            return data?.configuration ?? null
        }),
    )

    const invocationUrlFamily = atomFamily((runnableId: string) =>
        atom((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                const entity = get(hinted.config.molecule.selectors.data(runnableId))
                if (!entity) return null
                if (hinted.config.invocationUrlSelector) {
                    return get(hinted.config.invocationUrlSelector(runnableId))
                }
                const data = hinted.config.toRunnable(entity)
                return data?.invocationUrl ?? null
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = get(config.molecule.selectors.data(runnableId))
                if (entity) {
                    if (config.invocationUrlSelector) {
                        return get(config.invocationUrlSelector(runnableId))
                    }
                    const data = config.toRunnable(entity)
                    return data?.invocationUrl ?? null
                }
            }
            return null
        }),
    )

    const schemasFamily = atomFamily((runnableId: string) =>
        atom((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                const entity = get(hinted.config.molecule.selectors.data(runnableId))
                if (!entity) return null
                if (hinted.config.schemasSelector) {
                    return get(hinted.config.schemasSelector(runnableId))
                }
                const data = hinted.config.toRunnable(entity)
                return data?.schemas ?? null
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = get(config.molecule.selectors.data(runnableId))
                if (!entity) continue
                if (config.schemasSelector) {
                    return get(config.schemasSelector(runnableId))
                }
                const data = config.toRunnable(entity)
                return data?.schemas ?? null
            }
            return null
        }),
    )

    const parametersSchemaFamily = atomFamily((runnableId: string) =>
        atom<Record<string, unknown> | null>((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                const entity = get(hinted.config.molecule.selectors.data(runnableId))
                if (!entity) return null
                if (hinted.config.parametersSchemaSelector) {
                    return get(hinted.config.parametersSchemaSelector(runnableId))
                }
                return null
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = get(config.molecule.selectors.data(runnableId))
                if (!entity) continue
                if (config.parametersSchemaSelector) {
                    return get(config.parametersSchemaSelector(runnableId))
                }
            }
            return null
        }),
    )

    const draftFamily = atomFamily((runnableId: string) =>
        atom<unknown>((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                if (hinted.config.draftSelector) {
                    return get(hinted.config.draftSelector(runnableId))
                }
                return null
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = get(config.molecule.selectors.data(runnableId))
                if (entity) {
                    if (config.draftSelector) {
                        return get(config.draftSelector(runnableId))
                    }
                    return null
                }
            }
            return null
        }),
    )

    const serverDataFamily = atomFamily((runnableId: string) =>
        atom<RunnableData | null>((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                if (!hinted.config.serverDataSelector) return null
                const entity = get(hinted.config.serverDataSelector(runnableId))
                return entity ? hinted.config.toRunnable(entity) : null
            }
            for (const [_type, config] of Object.entries(runnables)) {
                if (!config.serverDataSelector) continue
                const entity = get(config.serverDataSelector(runnableId))
                if (entity) {
                    return config.toRunnable(entity)
                }
            }
            return null
        }),
    )

    const serverConfigurationFamily = atomFamily((runnableId: string) =>
        atom<Record<string, unknown> | null>((get) => {
            const data = get(serverDataFamily(runnableId))
            return data?.configuration ?? null
        }),
    )

    const isLatestRevisionFamily = atomFamily((runnableId: string) =>
        atom<boolean>((get) => {
            if (!runnableId) return false
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                const entity = get(hinted.config.molecule.selectors.data(runnableId))
                if (
                    !entity ||
                    !hinted.config.parentIdExtractor ||
                    !hinted.config.latestRevisionIdSelector
                )
                    return false
                const parentId = hinted.config.parentIdExtractor(entity)
                if (!parentId) return false
                const latestId = get(hinted.config.latestRevisionIdSelector(parentId))
                return runnableId === latestId
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = get(config.molecule.selectors.data(runnableId))
                if (entity) {
                    if (!config.parentIdExtractor || !config.latestRevisionIdSelector) return false
                    const parentId = config.parentIdExtractor(entity)
                    if (!parentId) return false
                    const latestId = get(config.latestRevisionIdSelector(parentId))
                    return runnableId === latestId
                }
            }
            return false
        }),
    )

    const executionModeFamily = atomFamily((runnableId: string) =>
        atom<"chat" | "completion">((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                const entity = get(hinted.config.molecule.selectors.data(runnableId))
                if (!entity) return "completion"
                if (hinted.config.executionModeSelector) {
                    return get(hinted.config.executionModeSelector(runnableId))
                }
                return "completion"
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = get(config.molecule.selectors.data(runnableId))
                if (entity) {
                    if (config.executionModeSelector) {
                        return get(config.executionModeSelector(runnableId))
                    }
                    return "completion"
                }
            }
            return "completion"
        }),
    )

    const requestPayloadFamily = atomFamily((runnableId: string) =>
        atom((get) => {
            const hinted = getHintedConfig(runnableId)
            if (hinted) {
                const entity = get(hinted.config.molecule.selectors.data(runnableId))
                if (!entity) return null
                if (hinted.config.requestPayloadSelector) {
                    return get(hinted.config.requestPayloadSelector(runnableId))
                }
                return null
            }
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = get(config.molecule.selectors.data(runnableId))
                if (entity) {
                    if (config.requestPayloadSelector) {
                        return get(config.requestPayloadSelector(runnableId))
                    }
                    return null
                }
            }
            return null
        }),
    )

    // Create selectors using stable atom families
    const selectors: RunnableBridgeSelectors = {
        data: (runnableId: string) => dataFamily(runnableId),

        dataForType: (runnableType: string, runnableId: string) =>
            dataForTypeFamily({runnableType, runnableId}),

        query: (runnableId: string) => queryFamily(runnableId),

        isDirty: (runnableId: string) => isDirtyFamily(runnableId),

        inputPorts: (runnableId: string) => inputPortsFamily(runnableId),

        outputPorts: (runnableId: string) => outputPortsFamily(runnableId),

        configuration: (runnableId: string) => configurationFamily(runnableId),

        invocationUrl: (runnableId: string) => invocationUrlFamily(runnableId),

        schemas: (runnableId: string) => schemasFamily(runnableId),

        parametersSchema: (runnableId: string) => parametersSchemaFamily(runnableId),

        executionMode: (runnableId: string) => executionModeFamily(runnableId),

        requestPayload: (runnableId: string) => requestPayloadFamily(runnableId),

        draft: (runnableId: string) => draftFamily(runnableId),

        isLatestRevision: (runnableId: string) => isLatestRevisionFamily(runnableId),

        serverData: (runnableId: string) => serverDataFamily(runnableId),

        serverConfiguration: (runnableId: string) => serverConfigurationFamily(runnableId),
    }

    // Build normalizeResponse utility: finds the matching type config for a
    // runnableId and delegates to its normalizeResponse if defined.
    const normalizeResponse = (
        runnableId: string,
        responseData: unknown,
    ): {output: unknown; trace?: {id: string} | undefined} => {
        const store = getDefaultStore()
        // Fast path: use type hint
        const hinted = getHintedConfig(runnableId)
        if (hinted) {
            const entity = store.get(hinted.config.molecule.selectors.data(runnableId))
            if (entity && hinted.config.normalizeResponse) {
                return hinted.config.normalizeResponse(responseData)
            }
        } else {
            for (const [_type, cfg] of Object.entries(runnables)) {
                const entity = store.get(cfg.molecule.selectors.data(runnableId))
                if (entity && cfg.normalizeResponse) {
                    return cfg.normalizeResponse(responseData)
                }
            }
        }
        // Default: standard response parsing
        const data = responseData as Record<string, unknown> | null | undefined
        const output = data?.data !== undefined ? data.data : data
        const traceId = data?.trace_id as string | undefined
        return {output, trace: traceId ? {id: traceId} : undefined}
    }

    return {
        // Nested API (backwards compatible)
        selectors,
        normalizeResponse,
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

        forType: (runnableType: string): TypeScopedRunnableSelectors => {
            const config = runnables[runnableType]
            if (!config) {
                // Fallback to generic selectors when type is not recognized
                return {
                    data: selectors.data,
                    invocationUrl: selectors.invocationUrl,
                    requestPayload: selectors.requestPayload,
                    executionMode: selectors.executionMode,
                    configuration: selectors.configuration,
                    inputPorts: selectors.inputPorts,
                    outputPorts: selectors.outputPorts,
                    schemas: selectors.schemas,
                    parametersSchema: selectors.parametersSchema,
                    query: selectors.query,
                    isDirty: selectors.isDirty,
                    draft: selectors.draft,
                    isLatestRevision: selectors.isLatestRevision,
                    serverData: selectors.serverData,
                    serverConfiguration: selectors.serverConfiguration,
                }
            }

            return {
                data: (runnableId: string) =>
                    atom((get) => {
                        const entity = get(config.molecule.selectors.data(runnableId))
                        if (!entity) return null
                        return config.toRunnable(entity)
                    }),
                invocationUrl: (runnableId: string) =>
                    atom((get) => {
                        const entity = get(config.molecule.selectors.data(runnableId))
                        if (!entity) return null
                        if (config.invocationUrlSelector) {
                            return get(config.invocationUrlSelector(runnableId))
                        }
                        const data = config.toRunnable(entity)
                        return data?.invocationUrl ?? null
                    }),
                requestPayload: (runnableId: string) =>
                    atom((get) => {
                        const entity = get(config.molecule.selectors.data(runnableId))
                        if (!entity) return null
                        if (config.requestPayloadSelector) {
                            return get(config.requestPayloadSelector(runnableId))
                        }
                        return null
                    }),
                executionMode: (runnableId: string) =>
                    atom<"chat" | "completion">((get) => {
                        const entity = get(config.molecule.selectors.data(runnableId))
                        if (!entity) return "completion"
                        if (config.executionModeSelector) {
                            return get(config.executionModeSelector(runnableId))
                        }
                        return "completion"
                    }),
                configuration: (runnableId: string) =>
                    atom((get) => {
                        const entity = get(config.molecule.selectors.data(runnableId))
                        if (!entity) return null
                        const data = config.toRunnable(entity)
                        return data?.configuration ?? null
                    }),
                inputPorts: (runnableId: string) =>
                    atom((get) => {
                        const entity = get(config.molecule.selectors.data(runnableId))
                        if (!entity) return []
                        if (config.inputPortsSelector) {
                            return get(config.inputPortsSelector(runnableId))
                        }
                        return config.getInputPorts(entity)
                    }),
                outputPorts: (runnableId: string) =>
                    atom((get) => {
                        const entity = get(config.molecule.selectors.data(runnableId))
                        if (!entity) return []
                        if (config.outputPortsSelector) {
                            return get(config.outputPortsSelector(runnableId))
                        }
                        return config.getOutputPorts(entity)
                    }),
                schemas: (runnableId: string) =>
                    atom((get) => {
                        const entity = get(config.molecule.selectors.data(runnableId))
                        if (!entity) return null
                        if (config.schemasSelector) {
                            return get(config.schemasSelector(runnableId))
                        }
                        const data = config.toRunnable(entity)
                        return data?.schemas ?? null
                    }),
                parametersSchema: (runnableId: string) =>
                    atom<Record<string, unknown> | null>((get) => {
                        const entity = get(config.molecule.selectors.data(runnableId))
                        if (!entity) return null
                        if (config.parametersSchemaSelector) {
                            return get(config.parametersSchemaSelector(runnableId))
                        }
                        return null
                    }),
                query: (runnableId: string) =>
                    atom((get) => {
                        const query = get(config.molecule.selectors.query(runnableId))
                        return query as BridgeQueryState<RunnableData>
                    }),
                isDirty: (runnableId: string) =>
                    atom((get) => {
                        return get(config.molecule.selectors.isDirty(runnableId))
                    }),
                draft: (runnableId: string) =>
                    atom<unknown>((get) => {
                        if (config.draftSelector) {
                            return get(config.draftSelector(runnableId))
                        }
                        return null
                    }),
                isLatestRevision: (runnableId: string) =>
                    atom<boolean>((get) => {
                        if (
                            !runnableId ||
                            !config.parentIdExtractor ||
                            !config.latestRevisionIdSelector
                        )
                            return false
                        const entity = get(config.molecule.selectors.data(runnableId))
                        if (!entity) return false
                        const parentId = config.parentIdExtractor(entity)
                        if (!parentId) return false
                        const latestId = get(config.latestRevisionIdSelector(parentId))
                        return runnableId === latestId
                    }),
                serverData: (runnableId: string) =>
                    atom<RunnableData | null>((get) => {
                        if (!config.serverDataSelector) return null
                        const entity = get(config.serverDataSelector(runnableId))
                        return entity ? config.toRunnable(entity) : null
                    }),
                serverConfiguration: (runnableId: string) =>
                    atom<Record<string, unknown> | null>((get) => {
                        if (!config.serverDataSelector) return null
                        const entity = get(config.serverDataSelector(runnableId))
                        if (!entity) return null
                        const data = config.toRunnable(entity)
                        return data?.configuration ?? null
                    }),
            }
        },

        // =====================================================================
        // FLATTENED API (preferred)
        // These are top-level aliases for cleaner imports:
        //   runnable.inputPorts(id) instead of runnable.selectors.inputPorts(id)
        // =====================================================================

        /** Get runnable data by ID (probes all molecule types) */
        data: selectors.data,
        /** Get runnable data by type + ID (queries only the specified molecule) */
        dataForType: selectors.dataForType,
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
        /** Get I/O schemas */
        schemas: selectors.schemas,
        /** Get parameters/configuration JSON schema */
        parametersSchema: selectors.parametersSchema,
        /** Get execution mode ("chat" or "completion") */
        executionMode: selectors.executionMode,
        /** Get pre-built request payload (config portion of API request body) */
        requestPayload: selectors.requestPayload,
        /** Get raw draft state for change detection */
        draft: selectors.draft,
        /** Check if revision is the latest for its parent entity */
        isLatestRevision: selectors.isLatestRevision,
        /** Get server data (before draft overlay) as RunnableData */
        serverData: selectors.serverData,
        /** Get server configuration (before draft overlay) */
        serverConfiguration: selectors.serverConfiguration,

        /** Entity-level CRUD actions */
        crud: crud ?? _noopCrud,

        /** Update draft parameters for an entity (routes to correct molecule) */
        update: atom(null, (_get, set, entityId: string, parameters: Record<string, unknown>) => {
            const hinted = getHintedConfig(entityId)
            if (hinted) {
                set(hinted.config.molecule.actions.update, entityId, {
                    data: {parameters},
                })
                return
            }
            // Probe all types — update the first match
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = _get(config.molecule.selectors.data(entityId))
                if (entity) {
                    set(config.molecule.actions.update, entityId, {
                        data: {parameters},
                    })
                    return
                }
            }
        }),

        /** Discard draft changes for an entity (routes to correct molecule) */
        discard: atom(null, (_get, set, entityId: string) => {
            const hinted = getHintedConfig(entityId)
            if (hinted) {
                set(hinted.config.molecule.actions.discard, entityId)
                return
            }
            // Probe all types — discard the first match
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = _get(config.molecule.selectors.data(entityId))
                if (entity) {
                    set(config.molecule.actions.discard, entityId)
                    return
                }
            }
        }),

        /** Invalidate all caches across all registered entity types */
        invalidateAllCaches: () => {
            for (const [_type, config] of Object.entries(runnables)) {
                config.invalidateCache?.()
            }
        },

        /** Create a local draft by cloning a server revision */
        createLocalDraft: (sourceRevisionId: string, appId?: string): string | null => {
            const store = getDefaultStore()
            const hinted = getHintedConfig(sourceRevisionId)
            if (hinted) {
                if (hinted.config.createLocalDraft) {
                    return hinted.config.createLocalDraft(sourceRevisionId, appId)
                }
                return null
            }
            // Probe all types — use the first match
            for (const [_type, config] of Object.entries(runnables)) {
                const entity = store.get(config.molecule.selectors.data(sourceRevisionId))
                if (entity) {
                    if (config.createLocalDraft) {
                        return config.createLocalDraft(sourceRevisionId, appId)
                    }
                    return null
                }
            }
            return null
        },
    }
}

/** No-op CRUD actions for when no crud config is provided */
const _noopCrud: RunnableBridgeCrudActions = {
    createVariant: atom(null, async (_get, _set, _params: unknown) => {
        throw new Error("No CRUD actions configured on runnableBridge")
    }),
    commitRevision: atom(null, async (_get, _set, _params: unknown) => {
        throw new Error("No CRUD actions configured on runnableBridge")
    }),
    deleteRevision: atom(null, async (_get, _set, _params: unknown) => {
        throw new Error("No CRUD actions configured on runnableBridge")
    }),
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Get the internal loadable state family (for advanced usage)
 */
export {loadableStateFamily}
