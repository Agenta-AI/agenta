/**
 * Entity Selection Hooks
 *
 * Hooks for building entity selection UI.
 */

// ============================================================================
// UNIFIED HOOK (Recommended)
// ============================================================================

// useEntitySelection - Unified facade for all selection modes
export {
    useEntitySelection,
    // Mode-specific hooks (for direct usage)
    useCascadingMode,
    useBreadcrumbMode,
    useListPopoverMode,
    // Core hook (for advanced usage)
    useEntitySelectionCore,
    getLevelLabel,
    getLevelPlaceholder,
} from "./useEntitySelection"

export type {
    // Unified types
    EntitySelectionMode,
    UseEntitySelectionOptions,
    UseEntitySelectionResult,
    CascadingModeOptions,
    BreadcrumbModeOptions,
    ListPopoverModeOptions,
    // Mode-specific types
    UseCascadingModeOptions,
    UseCascadingModeResult,
    UseBreadcrumbModeOptions,
    UseBreadcrumbModeResult,
    UseListPopoverModeOptions,
    UseListPopoverModeResult,
    // Level state types
    CascadingLevelState,
    ListPopoverParentState,
    ListPopoverChildrenState,
    // Core types
    EntitySelectionCoreOptions,
    EntitySelectionCoreResult,
} from "./useEntitySelection"

// Utilities (re-exported from useEntitySelection for convenience)
export * from "./utilities"

// Modes (re-exported from useEntitySelection for convenience)
export {useChildrenData, useAutoSelectLatestChild} from "./modes"
export type {UseAutoSelectLatestChildOptions} from "./modes"
