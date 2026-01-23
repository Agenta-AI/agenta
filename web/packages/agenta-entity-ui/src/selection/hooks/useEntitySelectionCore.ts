/**
 * useEntitySelectionCore Hook
 *
 * Core shared logic for all entity selection modes.
 * Handles adapter resolution, instance management, and common state.
 *
 * This is the foundation that mode-specific hooks build upon.
 */

import {useCallback, useEffect, useId, useMemo, useRef} from "react"

import {resolveAdapter} from "../adapters/createAdapter"
import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    HierarchyLevel,
    SelectionPathItem,
} from "../types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Common options shared by all selection modes
 */
export interface EntitySelectionCoreOptions<TSelection = EntitySelectionResult> {
    /**
     * Adapter or adapter name to use for selection.
     * Can be a pre-configured adapter object or a registered adapter name.
     */
    adapter: EntitySelectionAdapter<TSelection> | string

    /**
     * Instance ID for state isolation.
     * Auto-generated if not provided.
     * Use explicit IDs when you need to persist or share state.
     */
    instanceId?: string

    /**
     * Callback when selection is complete.
     * Called with the full selection result.
     */
    onSelect?: (selection: TSelection) => void

    /**
     * Override auto-select behavior per level.
     * Array index corresponds to level index.
     * Undefined entries use adapter/level defaults.
     *
     * @example
     * ```typescript
     * autoSelectByLevel: [false, false, true] // Only auto-select at level 2
     * ```
     */
    autoSelectByLevel?: (boolean | undefined)[]
}

/**
 * Core state and utilities returned by all modes
 */
export interface EntitySelectionCoreResult<TSelection = EntitySelectionResult> {
    /** Resolved adapter instance */
    adapter: EntitySelectionAdapter<TSelection>

    /** Hierarchy levels from adapter */
    hierarchyLevels: HierarchyLevel<unknown>[]

    /** Stable instance ID */
    instanceId: string

    /** Selectable level index (defaults to last level) */
    selectableLevel: number

    /** Get auto-select setting for a level */
    shouldAutoSelectAtLevel: (levelIndex: number) => boolean

    /** Create selection result from path and entity */
    createSelection: (path: SelectionPathItem[], leafEntity: unknown) => TSelection

    /** Check if path is complete */
    isPathComplete: (path: SelectionPathItem[]) => boolean
}

// ============================================================================
// HOOK: useEntitySelectionCore
// ============================================================================

/**
 * Core hook providing shared logic for entity selection.
 *
 * This hook:
 * - Resolves adapter from name or object
 * - Generates stable instance ID
 * - Provides hierarchy level access
 * - Handles auto-select configuration
 * - Creates selection results
 *
 * @example
 * ```typescript
 * const {
 *     adapter,
 *     hierarchyLevels,
 *     instanceId,
 *     shouldAutoSelectAtLevel,
 *     createSelection,
 * } = useEntitySelectionCore({
 *     adapter: "appRevision",
 *     onSelect: handleSelect,
 *     autoSelectByLevel: [false, false, true],
 * })
 * ```
 */
export function useEntitySelectionCore<TSelection = EntitySelectionResult>(
    options: EntitySelectionCoreOptions<TSelection>,
): EntitySelectionCoreResult<TSelection> {
    const {adapter: adapterOrName, instanceId: providedInstanceId, autoSelectByLevel} = options

    // Generate stable instance ID
    const generatedId = useId()
    const instanceId = providedInstanceId ?? generatedId

    // Resolve adapter (memoized by reference/name)
    const adapter = useMemo(
        () => resolveAdapter(adapterOrName) as EntitySelectionAdapter<TSelection>,
        [adapterOrName],
    )

    // Extract hierarchy configuration
    const hierarchyLevels = adapter.hierarchy.levels
    const selectableLevel = adapter.hierarchy.selectableLevel ?? hierarchyLevels.length - 1

    // Create auto-select check function
    const shouldAutoSelectAtLevel = useCallback(
        (levelIndex: number): boolean => {
            // Check override first
            if (autoSelectByLevel?.[levelIndex] !== undefined) {
                return autoSelectByLevel[levelIndex]!
            }

            // Fall back to level config
            const levelConfig = hierarchyLevels[levelIndex]
            return levelConfig?.autoSelectSingle ?? false
        },
        [autoSelectByLevel, hierarchyLevels],
    )

    // Create selection result factory
    const createSelection = useCallback(
        (path: SelectionPathItem[], leafEntity: unknown): TSelection => {
            return adapter.toSelection(path, leafEntity)
        },
        [adapter],
    )

    // Check if path is complete
    const isPathComplete = useCallback(
        (path: SelectionPathItem[]): boolean => {
            return adapter.isComplete(path)
        },
        [adapter],
    )

    return {
        adapter,
        hierarchyLevels,
        instanceId,
        selectableLevel,
        shouldAutoSelectAtLevel,
        createSelection,
        isPathComplete,
    }
}

// ============================================================================
// HOOK: useAdapterChangeReset
// ============================================================================

/**
 * Hook that tracks adapter changes and provides a reset trigger.
 *
 * Use this to reset selection state when the adapter changes.
 *
 * @example
 * ```typescript
 * const { shouldReset } = useAdapterChangeReset(adapter)
 *
 * useEffect(() => {
 *     if (shouldReset) {
 *         resetSelection()
 *     }
 * }, [shouldReset])
 * ```
 */
export interface UseAdapterChangeResetResult {
    /** Whether adapter just changed (triggers reset) */
    shouldReset: boolean
    /** Previous adapter name (for debugging) */
    previousAdapterName: string | null
}

export function useAdapterChangeReset<TSelection = EntitySelectionResult>(
    adapter: EntitySelectionAdapter<TSelection>,
): UseAdapterChangeResetResult {
    const prevAdapterNameRef = useRef<string | null>(null)
    const [shouldReset, setShouldReset] = useMemoReset(false)

    useEffect(() => {
        if (prevAdapterNameRef.current !== null && prevAdapterNameRef.current !== adapter.name) {
            setShouldReset(true)
        }
        prevAdapterNameRef.current = adapter.name
    }, [adapter.name, setShouldReset])

    return {
        shouldReset,
        previousAdapterName: prevAdapterNameRef.current,
    }
}

// Helper for reset state that auto-clears
function useMemoReset(initial: boolean): [boolean, (value: boolean) => void] {
    const ref = useRef(initial)
    const set = useCallback((value: boolean) => {
        ref.current = value
        // Auto-clear after one tick
        if (value) {
            setTimeout(() => {
                ref.current = false
            }, 0)
        }
    }, [])

    return [ref.current, set]
}

// ============================================================================
// HOOK: useSelectionCallbackTrigger
// ============================================================================

/**
 * Hook that safely triggers onSelect callback.
 *
 * Prevents duplicate calls for the same selection ID.
 * Handles null selections gracefully.
 *
 * @example
 * ```typescript
 * const triggerSelect = useSelectionCallbackTrigger(onSelect)
 *
 * useEffect(() => {
 *     if (selection) {
 *         triggerSelect(selection)
 *     }
 * }, [selection])
 * ```
 */
export function useSelectionCallbackTrigger<TSelection = EntitySelectionResult>(
    onSelect?: (selection: TSelection) => void,
    getSelectionId?: (selection: TSelection) => string,
): (selection: TSelection | null) => void {
    const prevSelectionIdRef = useRef<string | null>(null)

    // Default ID extractor (assumes EntitySelectionResult-like structure)
    const extractId = getSelectionId ?? ((s: TSelection) => (s as EntitySelectionResult).id)

    return useCallback(
        (selection: TSelection | null) => {
            if (!selection || !onSelect) return

            const currentId = extractId(selection)
            if (currentId !== prevSelectionIdRef.current) {
                prevSelectionIdRef.current = currentId
                onSelect(selection)
            }
        },
        [onSelect, extractId],
    )
}

// ============================================================================
// UTILITY: getLevelLabel
// ============================================================================

/**
 * Get display label for a hierarchy level.
 *
 * Falls back to capitalized type if no label defined.
 *
 * @example
 * ```typescript
 * const label = getLevelLabel(levelConfig) // "Application" or "app"
 * ```
 */
export function getLevelLabel(levelConfig: HierarchyLevel<unknown>): string {
    if (levelConfig.label) {
        return levelConfig.label
    }
    // Capitalize type as fallback
    return levelConfig.type.charAt(0).toUpperCase() + levelConfig.type.slice(1)
}

// ============================================================================
// UTILITY: getLevelPlaceholder
// ============================================================================

/**
 * Get placeholder text for a level.
 *
 * @example
 * ```typescript
 * const placeholder = getLevelPlaceholder(levelConfig, isEnabled, prevLevelLabel)
 * // "Select application..." or "Select variant first"
 * ```
 */
export function getLevelPlaceholder(
    levelConfig: HierarchyLevel<unknown>,
    isEnabled: boolean,
    previousLevelLabel?: string,
): string {
    const label = getLevelLabel(levelConfig)

    if (!isEnabled && previousLevelLabel) {
        return `Select ${previousLevelLabel.toLowerCase()} first`
    }

    return `Select ${label.toLowerCase()}...`
}
