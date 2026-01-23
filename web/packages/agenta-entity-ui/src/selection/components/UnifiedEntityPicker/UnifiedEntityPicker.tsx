/**
 * UnifiedEntityPicker Component
 *
 * A single unified component for entity selection with variant support.
 * Renders differently based on the `variant` prop:
 *
 * - "cascading": All levels as side-by-side Select dropdowns (App → Variant → Revision)
 * - "breadcrumb": One level at a time with breadcrumb navigation
 * - "list-popover": Vertical list with hover popovers for 2-level hierarchies
 *
 * @example
 * ```tsx
 * import { EntityPicker } from '@agenta/entity-ui'
 *
 * // Cascading selects
 * <EntityPicker variant="cascading" adapter="appRevision" onSelect={handleSelect} />
 *
 * // Breadcrumb navigation
 * <EntityPicker variant="breadcrumb" adapter="appRevision" onSelect={handleSelect} />
 *
 * // List with popover
 * <EntityPicker variant="list-popover" adapter="testset" onSelect={handleSelect} />
 * ```
 */

import React from "react"

import type {EntitySelectionResult} from "../../types"

import type {EntityPickerProps} from "./types"
import {BreadcrumbVariant, CascadingVariant, ListPopoverVariant} from "./variants"

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Unified entity selection component with variant support.
 *
 * Provides a consistent API for different selection UI patterns:
 * - Cascading selects for multi-level simultaneous selection
 * - Breadcrumb navigation for drill-down selection
 * - List with popover for 2-level parent-child selection
 *
 * @example Cascading selects (like EntitySelectGroup)
 * ```tsx
 * <EntityPicker
 *     variant="cascading"
 *     adapter="appRevision"
 *     onSelect={handleSelect}
 *     showLabels
 *     layout="vertical"
 * />
 * ```
 *
 * @example Breadcrumb navigation (like old EntityPicker)
 * ```tsx
 * <EntityPicker
 *     variant="breadcrumb"
 *     adapter="appRevision"
 *     onSelect={handleSelect}
 *     showBreadcrumb
 *     infiniteScroll
 * />
 * ```
 *
 * @example List with popover (like EntityListWithPopover)
 * ```tsx
 * <EntityPicker
 *     variant="list-popover"
 *     adapter="testset"
 *     onSelect={handleSelect}
 *     autoSelectLatest
 *     selectLatestOnParentClick
 * />
 * ```
 */
export function EntityPicker<TSelection = EntitySelectionResult>(
    props: EntityPickerProps<TSelection>,
) {
    const {variant} = props

    switch (variant) {
        case "cascading":
            return <CascadingVariant {...props} />

        case "breadcrumb":
            return <BreadcrumbVariant {...props} />

        case "list-popover":
            return <ListPopoverVariant {...props} />

        default:
            // TypeScript should catch this, but throw for runtime safety
            throw new Error(`Unknown EntityPicker variant: ${(props as {variant: string}).variant}`)
    }
}
