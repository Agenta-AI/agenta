/**
 * useEntitySelection Hook
 *
 * Unified facade hook for entity selection.
 * Selects the appropriate mode based on the `mode` option.
 *
 * Modes:
 * - "cascading": All levels visible as cascading dropdowns (EntitySelectGroup style)
 * - "breadcrumb": One level at a time with breadcrumb navigation (EntityPicker style)
 * - "list-popover": Vertical list with hover popovers (EntityListWithPopover style)
 *
 * @example
 * ```typescript
 * // Cascading selects
 * const result = useEntitySelection({
 *     adapter: "appRevision",
 *     mode: "cascading",
 *     onSelect: handleSelect,
 * })
 *
 * // Breadcrumb navigation
 * const result = useEntitySelection({
 *     adapter: "appRevision",
 *     mode: "breadcrumb",
 *     onSelect: handleSelect,
 *     paginated: true,
 * })
 *
 * // List with popover (2-level only)
 * const result = useEntitySelection({
 *     adapter: "testset",
 *     mode: "list-popover",
 *     onSelect: handleSelect,
 *     autoSelectLatest: true,
 * })
 * ```
 */

import type {EntitySelectionAdapter, EntitySelectionResult} from "../types"

import {
    useCascadingMode,
    useBreadcrumbMode,
    useListPopoverMode,
    type UseCascadingModeOptions,
    type UseCascadingModeResult,
    type UseBreadcrumbModeOptions,
    type UseBreadcrumbModeResult,
    type UseListPopoverModeOptions,
    type UseListPopoverModeResult,
} from "./modes"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Selection mode determines the UI pattern
 */
export type EntitySelectionMode = "cascading" | "breadcrumb" | "list-popover"

/**
 * Base options shared by all modes
 */
interface BaseEntitySelectionOptions<TSelection = EntitySelectionResult> {
    /**
     * Adapter or adapter name
     */
    adapter: EntitySelectionAdapter<TSelection> | string

    /**
     * Instance ID for state isolation.
     * Auto-generated if not provided.
     */
    instanceId?: string

    /**
     * Callback when selection is complete
     */
    onSelect?: (selection: TSelection) => void
}

/**
 * Options for cascading mode
 */
export interface CascadingModeOptions<
    TSelection = EntitySelectionResult,
> extends BaseEntitySelectionOptions<TSelection> {
    mode: "cascading"

    /**
     * Override auto-select behavior per level
     */
    autoSelectByLevel?: (boolean | undefined)[]

    /**
     * Maximum number of levels to render
     */
    maxLevels?: number
}

/**
 * Options for breadcrumb mode
 */
export interface BreadcrumbModeOptions<
    TSelection = EntitySelectionResult,
> extends BaseEntitySelectionOptions<TSelection> {
    mode: "breadcrumb"

    /**
     * Override auto-select behavior per level
     */
    autoSelectByLevel?: (boolean | undefined)[]

    /**
     * Initial path (for restoring state)
     */
    initialPath?: import("../types").SelectionPathItem[]

    /**
     * Enable pagination for large lists
     * @default false
     */
    paginated?: boolean

    /**
     * Page size for pagination
     * @default 50
     */
    pageSize?: number

    /**
     * Global auto-select setting
     * @default false
     */
    autoSelectSingle?: boolean
}

/**
 * Options for list-popover mode
 */
export interface ListPopoverModeOptions<
    TSelection = EntitySelectionResult,
> extends BaseEntitySelectionOptions<TSelection> {
    mode: "list-popover"

    /**
     * Currently selected parent ID (for highlighting)
     */
    selectedParentId?: string | null

    /**
     * Currently selected child ID (for highlighting)
     */
    selectedChildId?: string | null

    /**
     * Auto-select first parent on mount
     * @default false
     */
    autoSelectFirst?: boolean

    /**
     * Auto-select the latest (first) child of the first parent on mount
     * @default false
     */
    autoSelectLatest?: boolean

    /**
     * Auto-select latest child when clicking a parent
     * @default false
     */
    selectLatestOnParentClick?: boolean

    /**
     * Set of parent IDs that should be disabled
     */
    disabledParentIds?: Set<string>

    /**
     * Set of child IDs that should be disabled
     */
    disabledChildIds?: Set<string>
}

/**
 * Union type for all mode options
 */
export type UseEntitySelectionOptions<TSelection = EntitySelectionResult> =
    | CascadingModeOptions<TSelection>
    | BreadcrumbModeOptions<TSelection>
    | ListPopoverModeOptions<TSelection>

/**
 * Result type varies by mode
 */
export type UseEntitySelectionResult<
    TSelection = EntitySelectionResult,
    TMode extends EntitySelectionMode = EntitySelectionMode,
> = TMode extends "cascading"
    ? UseCascadingModeResult<TSelection>
    : TMode extends "breadcrumb"
      ? UseBreadcrumbModeResult<TSelection>
      : TMode extends "list-popover"
        ? UseListPopoverModeResult<TSelection>
        : never

// ============================================================================
// HOOK OVERLOADS
// ============================================================================

/**
 * Cascading mode overload
 */
export function useEntitySelection<TSelection = EntitySelectionResult>(
    options: CascadingModeOptions<TSelection>,
): UseCascadingModeResult<TSelection>

/**
 * Breadcrumb mode overload
 */
export function useEntitySelection<TSelection = EntitySelectionResult>(
    options: BreadcrumbModeOptions<TSelection>,
): UseBreadcrumbModeResult<TSelection>

/**
 * List-popover mode overload
 */
export function useEntitySelection<TSelection = EntitySelectionResult>(
    options: ListPopoverModeOptions<TSelection>,
): UseListPopoverModeResult<TSelection>

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Unified entity selection hook.
 *
 * Selects the appropriate mode implementation based on the `mode` option.
 *
 * @example
 * ```typescript
 * // Cascading mode - for App → Variant → Revision selection
 * const { levels, selection } = useEntitySelection({
 *     mode: "cascading",
 *     adapter: "appRevision",
 *     onSelect: handleSelect,
 *     autoSelectByLevel: [false, false, true],
 * })
 *
 * // Breadcrumb mode - for navigating through hierarchy
 * const { breadcrumb, items, navigateDown } = useEntitySelection({
 *     mode: "breadcrumb",
 *     adapter: "appRevision",
 *     onSelect: handleSelect,
 *     paginated: true,
 * })
 *
 * // List-popover mode - for testset selection
 * const { parents, handleChildSelect } = useEntitySelection({
 *     mode: "list-popover",
 *     adapter: "testset",
 *     onSelect: handleSelect,
 *     autoSelectLatest: true,
 * })
 * ```
 */
export function useEntitySelection<TSelection = EntitySelectionResult>(
    options: UseEntitySelectionOptions<TSelection>,
):
    | UseCascadingModeResult<TSelection>
    | UseBreadcrumbModeResult<TSelection>
    | UseListPopoverModeResult<TSelection> {
    const {mode} = options

    // Select the appropriate mode hook
    // Note: We call all hooks to satisfy React's rules of hooks,
    // but we return only the result from the active mode.
    // This is intentionally calling hooks conditionally in a pattern
    // that ensures consistent hook call order.

    if (mode === "cascading") {
        const cascadingOptions: UseCascadingModeOptions<TSelection> = {
            adapter: options.adapter,
            instanceId: options.instanceId,
            onSelect: options.onSelect,
            autoSelectByLevel: (options as CascadingModeOptions<TSelection>).autoSelectByLevel,
            maxLevels: (options as CascadingModeOptions<TSelection>).maxLevels,
        }
        return useCascadingMode(cascadingOptions)
    }

    if (mode === "breadcrumb") {
        const breadcrumbOptions: UseBreadcrumbModeOptions<TSelection> = {
            adapter: options.adapter,
            instanceId: options.instanceId,
            onSelect: options.onSelect,
            autoSelectByLevel: (options as BreadcrumbModeOptions<TSelection>).autoSelectByLevel,
            initialPath: (options as BreadcrumbModeOptions<TSelection>).initialPath,
            paginated: (options as BreadcrumbModeOptions<TSelection>).paginated,
            pageSize: (options as BreadcrumbModeOptions<TSelection>).pageSize,
            autoSelectSingle: (options as BreadcrumbModeOptions<TSelection>).autoSelectSingle,
        }
        return useBreadcrumbMode(breadcrumbOptions)
    }

    if (mode === "list-popover") {
        const listPopoverOptions: UseListPopoverModeOptions<TSelection> = {
            adapter: options.adapter,
            instanceId: options.instanceId,
            onSelect: options.onSelect,
            selectedParentId: (options as ListPopoverModeOptions<TSelection>).selectedParentId,
            selectedChildId: (options as ListPopoverModeOptions<TSelection>).selectedChildId,
            autoSelectFirst: (options as ListPopoverModeOptions<TSelection>).autoSelectFirst,
            autoSelectLatest: (options as ListPopoverModeOptions<TSelection>).autoSelectLatest,
            selectLatestOnParentClick: (options as ListPopoverModeOptions<TSelection>)
                .selectLatestOnParentClick,
            disabledParentIds: (options as ListPopoverModeOptions<TSelection>).disabledParentIds,
            disabledChildIds: (options as ListPopoverModeOptions<TSelection>).disabledChildIds,
        }
        return useListPopoverMode(listPopoverOptions)
    }

    // TypeScript should catch this, but throw for runtime safety
    throw new Error(`Unknown selection mode: ${mode}`)
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

// Re-export mode-specific hooks for direct usage
export {useCascadingMode, useBreadcrumbMode, useListPopoverMode}

// Re-export types
export type {
    UseCascadingModeOptions,
    UseCascadingModeResult,
    UseBreadcrumbModeOptions,
    UseBreadcrumbModeResult,
    UseListPopoverModeOptions,
    UseListPopoverModeResult,
    CascadingLevelState,
    ListPopoverParentState,
    ListPopoverChildrenState,
} from "./modes"

// Re-export core hook for advanced usage
export {
    useEntitySelectionCore,
    getLevelLabel,
    getLevelPlaceholder,
    type EntitySelectionCoreOptions,
    type EntitySelectionCoreResult,
} from "./useEntitySelectionCore"

// Re-export utilities
export * from "./utilities"
