/**
 * Selection State
 *
 * Jotai atoms for managing hierarchical selection state.
 * Uses atomFamily for per-instance state management.
 */

import {atom} from "jotai"
import {atomWithReset, RESET} from "jotai/utils"
import {atomFamily} from "jotai-family"

import type {SelectionPathItem, HierarchicalSelectionState} from "../types"

// ============================================================================
// INSTANCE STATE (per selector instance)
// ============================================================================

/**
 * Default state for a new selection instance
 */
const defaultSelectionState: HierarchicalSelectionState = {
    currentPath: [],
    currentLevel: 0,
    searchTerm: "",
}

/**
 * Selection state per instance
 * Allows multiple independent selectors on the same page
 */
export const selectionStateFamily = atomFamily((instanceId: string) =>
    atomWithReset<HierarchicalSelectionState>(defaultSelectionState),
)

// ============================================================================
// DERIVED STATE
// ============================================================================

/**
 * Get current path for an instance
 */
export const currentPathFamily = atomFamily((instanceId: string) =>
    atom((get) => get(selectionStateFamily(instanceId)).currentPath),
)

/**
 * Get current level for an instance
 */
export const currentLevelFamily = atomFamily((instanceId: string) =>
    atom((get) => get(selectionStateFamily(instanceId)).currentLevel),
)

/**
 * Get search term for an instance
 */
export const searchTermFamily = atomFamily((instanceId: string) =>
    atom((get) => get(selectionStateFamily(instanceId)).searchTerm),
)

/**
 * Check if at root level
 */
export const isAtRootFamily = atomFamily((instanceId: string) =>
    atom((get) => get(selectionStateFamily(instanceId)).currentLevel === 0),
)

/**
 * Get parent ID at current level (for fetching children)
 */
export const currentParentIdFamily = atomFamily((instanceId: string) =>
    atom((get) => {
        const state = get(selectionStateFamily(instanceId))
        if (state.currentPath.length === 0) return null
        return state.currentPath[state.currentPath.length - 1]?.id ?? null
    }),
)

// ============================================================================
// ACTION ATOMS
// ============================================================================

/**
 * Navigate down into a child entity
 */
export const navigateDownFamily = atomFamily((instanceId: string) =>
    atom(null, (get, set, item: SelectionPathItem) => {
        const current = get(selectionStateFamily(instanceId))
        set(selectionStateFamily(instanceId), {
            ...current,
            currentPath: [...current.currentPath, item],
            currentLevel: current.currentLevel + 1,
            searchTerm: "", // Clear search when navigating
        })
    }),
)

/**
 * Navigate up one level
 */
export const navigateUpFamily = atomFamily((instanceId: string) =>
    atom(null, (get, set) => {
        const current = get(selectionStateFamily(instanceId))
        if (current.currentPath.length === 0) return

        set(selectionStateFamily(instanceId), {
            ...current,
            currentPath: current.currentPath.slice(0, -1),
            currentLevel: Math.max(0, current.currentLevel - 1),
            searchTerm: "",
        })
    }),
)

/**
 * Navigate to a specific level (by index)
 */
export const navigateToLevelFamily = atomFamily((instanceId: string) =>
    atom(null, (get, set, level: number) => {
        const current = get(selectionStateFamily(instanceId))
        const newLevel = Math.max(0, Math.min(level, current.currentPath.length))

        set(selectionStateFamily(instanceId), {
            ...current,
            currentPath: current.currentPath.slice(0, newLevel),
            currentLevel: newLevel,
            searchTerm: "",
        })
    }),
)

/**
 * Set search term
 */
export const setSearchTermFamily = atomFamily((instanceId: string) =>
    atom(null, (get, set, term: string) => {
        const current = get(selectionStateFamily(instanceId))
        set(selectionStateFamily(instanceId), {
            ...current,
            searchTerm: term,
        })
    }),
)

/**
 * Reset selection state
 */
export const resetSelectionFamily = atomFamily((instanceId: string) =>
    atom(null, (_get, set) => {
        set(selectionStateFamily(instanceId), RESET)
    }),
)

/**
 * Set full path (for restoring state)
 */
export const setPathFamily = atomFamily((instanceId: string) =>
    atom(null, (_get, set, path: SelectionPathItem[]) => {
        set(selectionStateFamily(instanceId), {
            currentPath: path,
            currentLevel: path.length,
            searchTerm: "",
        })
    }),
)

// ============================================================================
// SELECTION MOLECULE EXPORT
// ============================================================================

/**
 * Selection molecule providing atoms and actions for hierarchical selection
 *
 * @example
 * ```typescript
 * const instanceId = useId()
 *
 * // Read state
 * const path = useAtomValue(useMemo(() => selectionMolecule.atoms.path(instanceId), [instanceId]))
 * const isAtRoot = useAtomValue(useMemo(() => selectionMolecule.atoms.isAtRoot(instanceId), [instanceId]))
 *
 * // Actions
 * const navigateDown = useSetAtom(useMemo(() => selectionMolecule.actions.navigateDown(instanceId), [instanceId]))
 * navigateDown({ type: 'app', id: appId, label: appName })
 * ```
 */
export const selectionMolecule = {
    atoms: {
        /** Full state */
        state: selectionStateFamily,
        /** Current path (breadcrumb) */
        path: currentPathFamily,
        /** Current level index */
        level: currentLevelFamily,
        /** Search term */
        searchTerm: searchTermFamily,
        /** Is at root level */
        isAtRoot: isAtRootFamily,
        /** Parent ID for current level */
        parentId: currentParentIdFamily,
    },
    actions: {
        /** Navigate into a child */
        navigateDown: navigateDownFamily,
        /** Navigate up one level */
        navigateUp: navigateUpFamily,
        /** Navigate to specific level */
        navigateToLevel: navigateToLevelFamily,
        /** Set search term */
        setSearchTerm: setSearchTermFamily,
        /** Reset to initial state */
        reset: resetSelectionFamily,
        /** Set full path */
        setPath: setPathFamily,
    },
}
