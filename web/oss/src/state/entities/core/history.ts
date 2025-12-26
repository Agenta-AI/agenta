import {atom, type WritableAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {withHistory, UNDO, REDO, RESET} from "jotai-history"

import type {BaseEntity, StoredEntity} from "./types"

/**
 * History limit configuration
 * - number: specific limit (e.g., 5 states)
 * - "unlimited": no limit (use with caution for memory)
 */
export type HistoryLimit = number | "unlimited"

/**
 * Configuration for entity history
 */
export interface EntityHistoryConfig {
    /** Default history limit for all entities (default: 10) */
    defaultLimit?: HistoryLimit
    /** Whether to auto-clear history on commit (default: true) */
    clearOnCommit?: boolean
}

/**
 * History state for a single entity
 */
export interface EntityHistoryState<T> {
    /** Array of historical states (most recent first) */
    history: T[]
    /** Whether undo is available */
    canUndo: boolean
    /** Whether redo is available */
    canRedo: boolean
}

/**
 * Entity history manager - provides per-entity undo/redo capabilities
 * Uses lazy initialization to only track history for actively edited entities
 */
export function createEntityHistoryManager<TEntity extends BaseEntity>(
    entitiesAtom: WritableAtom<Record<string, StoredEntity<TEntity>>, [any], any>,
    config: EntityHistoryConfig = {},
) {
    const {defaultLimit = 10, clearOnCommit = true} = config

    // Convert limit to number for withHistory (use very large number for "unlimited")
    const getLimit = (limit: HistoryLimit): number => {
        return limit === "unlimited" ? Number.MAX_SAFE_INTEGER : limit
    }

    interface HistoryEntry {
        historyAtom: ReturnType<typeof withHistory>
        baseAtom: WritableAtom<TEntity | null, [TEntity | null], void>
        limit: HistoryLimit
    }

    /**
     * Atom storing map of entity ID to its history atoms
     * Using a Jotai atom makes this reactive
     */
    const historyAtomsMapAtom = atom<Record<string, HistoryEntry>>({})

    /**
     * Create history atoms for an entity (called within atom setter)
     */
    const createHistoryEntry = (entityId: string, limit: HistoryLimit): HistoryEntry => {
        // Create a base atom that syncs with the entity store
        const baseAtom = atom(
            (get) => {
                const entities = get(entitiesAtom)
                return entities[entityId]?.data ?? null
            },
            (get, set, newValue: TEntity | null) => {
                if (newValue === null) return

                set(entitiesAtom, (prev: Record<string, StoredEntity<TEntity>>) => {
                    const existing = prev[entityId]
                    if (!existing) return prev

                    return {
                        ...prev,
                        [entityId]: {
                            data: newValue,
                            metadata: {
                                ...existing.metadata,
                                isDirty: true,
                            },
                        },
                    }
                })
            },
        )

        // Wrap with history
        const historyAtom = withHistory(baseAtom, getLimit(limit))

        return {historyAtom, baseAtom, limit}
    }

    /**
     * Start tracking history for an entity
     * Call this when user starts editing (e.g., opens drawer)
     */
    const startHistoryAtom = atom(
        null,
        (get, set, {entityId, limit = defaultLimit}: {entityId: string; limit?: HistoryLimit}) => {
            const current = get(historyAtomsMapAtom)
            if (current[entityId]) return // Already tracking

            const entry = createHistoryEntry(entityId, limit)
            set(historyAtomsMapAtom, {...current, [entityId]: entry})
        },
    )

    /**
     * Stop tracking history for an entity and clear it
     * Call this when user commits changes or discards
     */
    const stopHistoryAtom = atom(null, (get, set, entityId: string) => {
        const historyMap = get(historyAtomsMapAtom)
        const entry = historyMap[entityId]
        if (entry) {
            // Reset history before removing
            set(entry.historyAtom, RESET)
            const {[entityId]: _, ...rest} = historyMap
            set(historyAtomsMapAtom, rest)
        }
    })

    /**
     * Undo last change for an entity
     */
    const undoAtom = atom(null, (get, set, entityId: string) => {
        const historyMap = get(historyAtomsMapAtom)
        const entry = historyMap[entityId]
        if (entry) {
            set(entry.historyAtom as any, UNDO)
        }
    })

    /**
     * Redo last undone change for an entity
     */
    const redoAtom = atom(null, (get, set, entityId: string) => {
        const historyMap = get(historyAtomsMapAtom)
        const entry = historyMap[entityId]
        if (entry) {
            set(entry.historyAtom as any, REDO)
        }
    })

    /**
     * Reset entity to original state (clear all history)
     */
    const resetAtom = atom(null, (get, set, entityId: string) => {
        const historyMap = get(historyAtomsMapAtom)
        const entry = historyMap[entityId]
        if (entry) {
            set(entry.historyAtom, RESET)
        }
    })

    /**
     * Clear history for all entities (call after successful commit)
     */
    const clearAllHistoryAtom = atom(null, (get, set) => {
        if (!clearOnCommit) return

        const historyMap = get(historyAtomsMapAtom)
        Object.values(historyMap).forEach((entry) => {
            set(entry.historyAtom, RESET)
        })
        set(historyAtomsMapAtom, {})
    })

    /**
     * Get history state for an entity (read-only)
     * Returns null if history is not being tracked for this entity
     */
    const historyStateAtomFamily = atomFamily((entityId: string) =>
        atom((get) => {
            const historyMap = get(historyAtomsMapAtom)
            const entry = historyMap[entityId]
            if (!entry) {
                return null
            }

            const historyValue = get(entry.historyAtom)

            return {
                history: historyValue,
                canUndo: (historyValue as any).canUndo ?? false,
                canRedo: (historyValue as any).canRedo ?? false,
            } as EntityHistoryState<TEntity>
        }),
    )

    /**
     * Check if entity has active history tracking
     */
    const hasHistoryAtomFamily = atomFamily((entityId: string) =>
        atom((get) => {
            const historyMap = get(historyAtomsMapAtom)
            return entityId in historyMap
        }),
    )

    /**
     * Check if entity can undo
     */
    const canUndoAtomFamily = atomFamily((entityId: string) =>
        atom((get) => {
            const historyMap = get(historyAtomsMapAtom)
            const entry = historyMap[entityId]
            if (!entry) return false
            const historyValue = get(entry.historyAtom)
            return (historyValue as any).canUndo ?? false
        }),
    )

    /**
     * Check if entity can redo
     */
    const canRedoAtomFamily = atomFamily((entityId: string) =>
        atom((get) => {
            const historyMap = get(historyAtomsMapAtom)
            const entry = historyMap[entityId]
            if (!entry) return false
            const historyValue = get(entry.historyAtom)
            return (historyValue as any).canRedo ?? false
        }),
    )

    /**
     * Update entity through history tracking
     * This is the key method - updates made through this will be tracked in history
     */
    const updateWithHistoryAtom = atom(
        null,
        (get, set, {entityId, updates}: {entityId: string; updates: Partial<TEntity>}) => {
            const historyMap = get(historyAtomsMapAtom)
            const entry = historyMap[entityId]
            if (!entry) {
                // No history tracking - fall back to direct update
                set(entitiesAtom, (prev: Record<string, StoredEntity<TEntity>>) => {
                    const existing = prev[entityId]
                    if (!existing) return prev
                    return {
                        ...prev,
                        [entityId]: {
                            data: {...existing.data, ...updates} as TEntity,
                            metadata: {...existing.metadata, isDirty: true},
                        },
                    }
                })
                return
            }

            // Get current entity data
            const entities = get(entitiesAtom)
            const current = entities[entityId]?.data
            if (!current) return

            // Create updated entity and set through history atom
            // This will be tracked by jotai-history
            const updated = {...current, ...updates} as TEntity
            set(entry.baseAtom, updated)
        },
    )

    return {
        // Lifecycle
        startHistoryAtom,
        stopHistoryAtom,
        clearAllHistoryAtom,

        // Actions
        undoAtom,
        redoAtom,
        resetAtom,
        updateWithHistoryAtom,

        // Selectors
        historyStateAtomFamily,
        hasHistoryAtomFamily,
        canUndoAtomFamily,
        canRedoAtomFamily,
        historyAtomsMapAtom,
    }
}

// Re-export symbols for convenience
export {UNDO, REDO, RESET} from "jotai-history"
