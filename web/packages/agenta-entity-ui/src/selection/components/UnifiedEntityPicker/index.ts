/**
 * UnifiedEntityPicker
 *
 * A single unified component for entity selection with variant support.
 *
 * @example
 * ```tsx
 * import { EntityPicker } from '@agenta/entity-ui'
 *
 * <EntityPicker variant="cascading" adapter="appRevision" onSelect={handleSelect} />
 * <EntityPicker variant="breadcrumb" adapter="appRevision" onSelect={handleSelect} />
 * <EntityPicker variant="list-popover" adapter="testset" onSelect={handleSelect} />
 * ```
 */

// Main component
export {EntityPicker} from "./UnifiedEntityPicker"

// Types
export type {
    EntityPickerVariant,
    EntityPickerProps,
    EntityPickerBaseProps,
    CascadingVariantProps,
    BreadcrumbVariantProps,
    ListPopoverVariantProps,
} from "./types"

// Variants (for advanced usage/customization)
export {CascadingVariant, BreadcrumbVariant, ListPopoverVariant} from "./variants"

// Shared components (for advanced usage/customization)
export {
    LevelSelect,
    ChildPopoverContent,
    AutoSelectHandler,
    type LevelSelectProps,
    type ChildPopoverContentProps,
    type AutoSelectHandlerProps,
} from "./shared"
