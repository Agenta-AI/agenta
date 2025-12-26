import {useCallback, useEffect, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import type {WritableAtom} from "jotai"

import {createEntityHistoryManager, type EntityHistoryConfig, type HistoryLimit} from "./history"
import type {BaseEntity, StoredEntity} from "./types"

/**
 * Hook return type for entity history
 */
export interface UseEntityHistoryResult<TEntity extends BaseEntity> {
    /** Whether undo is available */
    canUndo: boolean
    /** Whether redo is available */
    canRedo: boolean
    /** Whether history is being tracked for this entity */
    isTracking: boolean
    /** Undo last change */
    undo: () => void
    /** Redo last undone change */
    redo: () => void
    /** Reset to original state (discard all changes) */
    reset: () => void
    /** Stop tracking history (call on unmount or commit) */
    stopTracking: () => void
    /** Update entity with history tracking - use this instead of useEntityMutation */
    update: (updates: Partial<TEntity>) => void
}

/**
 * Creates a hook for using entity history with a specific entity store
 *
 * @example
 * ```ts
 * // In entity store file
 * export const useTestcaseHistory = createUseEntityHistory(
 *   testcaseStore.entitiesAtom,
 *   { defaultLimit: 10 }
 * )
 *
 * // In component
 * function TestcaseDrawer({ testcaseId }) {
 *   const history = useTestcaseHistory(testcaseId, { limit: 5 })
 *
 *   return (
 *     <>
 *       <button onClick={history.undo} disabled={!history.canUndo}>Undo</button>
 *       <button onClick={history.redo} disabled={!history.canRedo}>Redo</button>
 *       <button onClick={history.reset}>Discard Changes</button>
 *     </>
 *   )
 * }
 * ```
 */
export function createUseEntityHistory<TEntity extends BaseEntity>(
    entitiesAtom: WritableAtom<Record<string, StoredEntity<TEntity>>, [any], any>,
    config: EntityHistoryConfig = {},
) {
    const historyManager = createEntityHistoryManager(entitiesAtom, config)

    return function useEntityHistory(
        entityId: string | null,
        options: {limit?: HistoryLimit; autoStart?: boolean} = {},
    ): UseEntityHistoryResult<TEntity> {
        const {limit, autoStart = true} = options

        // Actions
        const startHistory = useSetAtom(historyManager.startHistoryAtom)
        const stopHistory = useSetAtom(historyManager.stopHistoryAtom)
        const undo = useSetAtom(historyManager.undoAtom)
        const redo = useSetAtom(historyManager.redoAtom)
        const reset = useSetAtom(historyManager.resetAtom)
        const updateWithHistory = useSetAtom(historyManager.updateWithHistoryAtom)

        // Memoize atoms to avoid creating new instances on each render
        const canUndoAtom = useMemo(
            () => historyManager.canUndoAtomFamily(entityId || ""),
            [entityId],
        )
        const canRedoAtom = useMemo(
            () => historyManager.canRedoAtomFamily(entityId || ""),
            [entityId],
        )
        const isTrackingAtom = useMemo(
            () => historyManager.hasHistoryAtomFamily(entityId || ""),
            [entityId],
        )

        // Selectors
        const canUndo = useAtomValue(canUndoAtom)
        const canRedo = useAtomValue(canRedoAtom)
        const isTracking = useAtomValue(isTrackingAtom)

        // Auto-start history tracking when entityId changes
        useEffect(() => {
            if (entityId && autoStart) {
                startHistory({entityId, limit})
            }

            // Cleanup on unmount or entityId change
            return () => {
                // Don't auto-stop - let the component decide when to stop
                // This allows history to persist when navigating between entities
            }
        }, [entityId, limit, autoStart, startHistory])

        // Memoized callbacks
        const handleUndo = useCallback(() => {
            if (entityId) undo(entityId)
        }, [entityId, undo])

        const handleRedo = useCallback(() => {
            if (entityId) redo(entityId)
        }, [entityId, redo])

        const handleReset = useCallback(() => {
            if (entityId) reset(entityId)
        }, [entityId, reset])

        const handleStopTracking = useCallback(() => {
            if (entityId) stopHistory(entityId)
        }, [entityId, stopHistory])

        const handleUpdate = useCallback(
            (updates: Partial<TEntity>) => {
                if (entityId) updateWithHistory({entityId, updates})
            },
            [entityId, updateWithHistory],
        )

        return {
            canUndo: entityId ? canUndo : false,
            canRedo: entityId ? canRedo : false,
            isTracking: entityId ? isTracking : false,
            undo: handleUndo,
            redo: handleRedo,
            reset: handleReset,
            stopTracking: handleStopTracking,
            update: handleUpdate,
        }
    }
}

/**
 * Get the history manager for direct atom access
 * Useful for advanced use cases or testing
 */
export {createEntityHistoryManager} from "./history"
