/**
 * Entity Selection Modes
 *
 * Mode-specific hooks for different selection UI patterns.
 */

// Cascading mode (EntitySelectGroup style)
export {
    useCascadingMode,
    type CascadingLevelState,
    type UseCascadingModeOptions,
    type UseCascadingModeResult,
} from "./useCascadingMode"

// Breadcrumb mode (EntityPicker style)
export {
    useBreadcrumbMode,
    type UseBreadcrumbModeOptions,
    type UseBreadcrumbModeResult,
} from "./useBreadcrumbMode"

// List-popover mode (EntityListWithPopover style)
export {
    useListPopoverMode,
    useChildrenData,
    useAutoSelectLatestChild,
    type ListPopoverParentState,
    type ListPopoverChildrenState,
    type UseListPopoverModeOptions,
    type UseListPopoverModeResult,
    type UseAutoSelectLatestChildOptions,
} from "./useListPopoverMode"
