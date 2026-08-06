/**
 * useAutoSelect Utility
 *
 * Unified auto-selection logic for entity selection.
 * Handles auto-selecting when only one item is available at a level.
 *
 * Used by both cascading and hierarchical selection modes.
 */

import {useCallback, useEffect, useRef} from "react"

import type {HierarchyLevel} from "../../types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for auto-select behavior
 */
export interface AutoSelectOptions<T = unknown> {
    /** Items at the current level */
    items: T[]

    /** Whether loading is in progress */
    isLoading: boolean

    /** Whether auto-select is enabled for this level */
    enabled: boolean

    /** Level configuration with getId, getLabel, etc. */
    levelConfig: HierarchyLevel<T> | null

    /**
     * Callback when auto-selection should trigger.
     * Returns the item that should be auto-selected.
     */
    onAutoSelect?: (item: T) => void

    /**
     * Optional callback for navigation (when item has children).
     * Used in hierarchical mode to navigate down.
     */
    onAutoNavigate?: (item: T) => void

    /**
     * Check if item can be selected (for leaf selection)
     */
    canSelect?: (item: T) => boolean

    /**
     * Check if item can be navigated into (has children)
     */
    canNavigate?: (item: T) => boolean

    /**
     * Check if item is disabled
     */
    isDisabled?: (item: T) => boolean
}

/**
 * Result of auto-select evaluation
 */
export interface AutoSelectResult {
    /** Whether an auto-selection will occur */
    willAutoSelect: boolean

    /** Whether auto-selection is pending (waiting for items to load) */
    isPending: boolean

    /** The item that will be/was auto-selected */
    autoSelectedItem: unknown | null
}

// ============================================================================
// HOOK: useAutoSelect
// ============================================================================

/**
 * Hook that handles auto-selection logic.
 *
 * When enabled and exactly one item is available:
 * - If canSelect returns true, calls onAutoSelect
 * - If canNavigate returns true, calls onAutoNavigate
 *
 * Uses refs to prevent infinite loops and duplicate selections.
 *
 * @example
 * ```typescript
 * useAutoSelect({
 *     items,
 *     isLoading,
 *     enabled: autoSelectSingle,
 *     levelConfig,
 *     onAutoSelect: (item) => setSelectedId(levelConfig.getId(item)),
 *     canSelect: (item) => levelConfig.isSelectable?.(item) ?? true,
 * })
 * ```
 */
export function useAutoSelect<T = unknown>({
    items,
    isLoading,
    enabled,
    levelConfig,
    onAutoSelect,
    onAutoNavigate,
    canSelect,
    canNavigate,
    isDisabled,
}: AutoSelectOptions<T>): AutoSelectResult {
    // Track last auto-selected ID to prevent duplicate selections
    const lastAutoSelectedIdRef = useRef<string | null>(null)

    // Reset tracking when items change significantly
    useEffect(() => {
        if (items.length !== 1) {
            lastAutoSelectedIdRef.current = null
        }
    }, [items.length])

    // Perform auto-selection
    useEffect(() => {
        if (!enabled || isLoading || items.length !== 1 || !levelConfig) {
            return
        }

        const singleItem = items[0]
        const itemId = levelConfig.getId(singleItem)

        // Skip if we already auto-selected this item
        if (lastAutoSelectedIdRef.current === itemId) {
            return
        }

        // Check if item is disabled
        if (isDisabled?.(singleItem)) {
            return
        }

        // Check if item can be selected
        const canSelectItem = canSelect?.(singleItem) ?? true

        // Check if item can be navigated
        const canNavigateItem = canNavigate?.(singleItem) ?? false

        if (canSelectItem && onAutoSelect) {
            lastAutoSelectedIdRef.current = itemId
            onAutoSelect(singleItem)
        } else if (canNavigateItem && onAutoNavigate) {
            lastAutoSelectedIdRef.current = itemId
            onAutoNavigate(singleItem)
        }
    }, [
        enabled,
        isLoading,
        items,
        levelConfig,
        onAutoSelect,
        onAutoNavigate,
        canSelect,
        canNavigate,
        isDisabled,
    ])

    // Calculate result state
    const willAutoSelect = enabled && !isLoading && items.length === 1
    const autoSelectedItem = willAutoSelect ? items[0] : null

    return {
        willAutoSelect,
        isPending: enabled && isLoading,
        autoSelectedItem,
    }
}

// ============================================================================
// UTILITY: calculateAutoSelectState
// ============================================================================

/**
 * Calculate auto-select state synchronously (for cascading mode).
 *
 * Used when building level states to determine effectiveId.
 * Does not trigger side effects - just calculates the state.
 *
 * @example
 * ```typescript
 * const { effectiveId, isAutoSelected } = calculateAutoSelectState({
 *     userSelectedId: null,
 *     items,
 *     shouldAutoSelect: true,
 *     levelConfig,
 * })
 * ```
 */
export interface CalculateAutoSelectOptions<T = unknown> {
    /** User's explicit selection (null if none) */
    userSelectedId: string | null

    /** Items at this level */
    items: T[]

    /** Whether auto-select is enabled for this level */
    shouldAutoSelect: boolean

    /** Level configuration */
    levelConfig: HierarchyLevel<T>
}

export interface CalculateAutoSelectResult {
    /** The effective ID (user selection or auto-selected) */
    effectiveId: string | null

    /** Whether the effective selection was auto-selected */
    isAutoSelected: boolean
}

/**
 * Calculate effective selection state synchronously
 */
export function calculateAutoSelectState<T = unknown>({
    userSelectedId,
    items,
    shouldAutoSelect,
    levelConfig,
}: CalculateAutoSelectOptions<T>): CalculateAutoSelectResult {
    // User selection takes precedence
    if (userSelectedId) {
        return {
            effectiveId: userSelectedId,
            isAutoSelected: false,
        }
    }

    // Check for auto-select
    if (shouldAutoSelect && items.length === 1) {
        return {
            effectiveId: levelConfig.getId(items[0]),
            isAutoSelected: true,
        }
    }

    return {
        effectiveId: null,
        isAutoSelected: false,
    }
}

// ============================================================================
// HOOK: useAutoSelectCallback
// ============================================================================

/**
 * Creates a stable callback for handling auto-selection in cascading mode.
 *
 * This is useful when you want to imperatively trigger auto-selection
 * (e.g., when items change) without using effects.
 *
 * @example
 * ```typescript
 * const triggerAutoSelect = useAutoSelectCallback({
 *     levelConfig,
 *     shouldAutoSelect: true,
 *     onAutoSelect: setSelectedId,
 * })
 *
 * // Call when items load
 * useEffect(() => {
 *     if (items.length === 1 && !isLoading) {
 *         triggerAutoSelect(items)
 *     }
 * }, [items, isLoading])
 * ```
 */
export interface UseAutoSelectCallbackOptions<T = unknown> {
    /** Level configuration */
    levelConfig: HierarchyLevel<T> | null

    /** Whether auto-select is enabled */
    shouldAutoSelect: boolean

    /** Callback when auto-selection triggers */
    onAutoSelect: (id: string) => void
}

export function useAutoSelectCallback<T = unknown>({
    levelConfig,
    shouldAutoSelect,
    onAutoSelect,
}: UseAutoSelectCallbackOptions<T>): (items: T[]) => void {
    const lastIdRef = useRef<string | null>(null)

    return useCallback(
        (items: T[]) => {
            if (!shouldAutoSelect || items.length !== 1 || !levelConfig) {
                return
            }

            const id = levelConfig.getId(items[0])
            if (id !== lastIdRef.current) {
                lastIdRef.current = id
                onAutoSelect(id)
            }
        },
        [levelConfig, shouldAutoSelect, onAutoSelect],
    )
}
