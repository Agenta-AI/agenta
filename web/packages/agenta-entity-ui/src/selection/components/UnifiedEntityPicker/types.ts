/**
 * Unified EntityPicker Types
 *
 * Type definitions for the unified EntityPicker component with variant support.
 */

import type {ReactNode} from "react"

import type {EntitySelectionAdapter, EntitySelectionResult} from "../../types"

// ============================================================================
// VARIANT TYPE
// ============================================================================

/**
 * EntityPicker rendering variant
 */
export type EntityPickerVariant =
    | "cascading"
    | "breadcrumb"
    | "list-popover"
    | "cascader"
    | "popover-cascader"

// ============================================================================
// BASE PROPS
// ============================================================================

/**
 * Base props shared by all EntityPicker variants
 */
export interface EntityPickerBaseProps<TSelection = EntitySelectionResult> {
    /**
     * The adapter defining the entity hierarchy
     */
    adapter: EntitySelectionAdapter<TSelection> | string

    /**
     * Callback when an entity is selected
     */
    onSelect?: (selection: TSelection) => void

    /**
     * Instance ID for state isolation.
     * Auto-generated if not provided.
     */
    instanceId?: string

    /**
     * Show search input
     * @default true
     */
    showSearch?: boolean

    /**
     * Empty message when no items
     */
    emptyMessage?: string

    /**
     * Loading message
     */
    loadingMessage?: string

    /**
     * Additional CSS class
     */
    className?: string

    /**
     * Disabled state
     */
    disabled?: boolean
}

// ============================================================================
// CASCADING VARIANT PROPS
// ============================================================================

/**
 * Props for cascading variant (App → Variant → Revision style)
 *
 * Renders all hierarchy levels as side-by-side Select dropdowns.
 * Each level depends on the previous level's selection.
 */
export interface CascadingVariantProps<
    TSelection = EntitySelectionResult,
> extends EntityPickerBaseProps<TSelection> {
    variant: "cascading"

    /**
     * Override auto-select behavior per level.
     * Array of booleans matching hierarchy levels.
     */
    autoSelectByLevel?: (boolean | undefined)[]

    /**
     * Show labels above each select
     * @default true
     */
    showLabels?: boolean

    /**
     * Layout direction
     * @default "vertical"
     */
    layout?: "horizontal" | "vertical"

    /**
     * Gap between selects (Tailwind spacing scale)
     * @default 3
     */
    gap?: number

    /**
     * Select component size
     * @default "middle"
     */
    size?: "small" | "middle" | "large"

    /**
     * Custom placeholders per level (overrides adapter defaults)
     */
    placeholders?: string[]

    /**
     * Show "(auto)" indicator when a level is auto-selected
     * @default true
     */
    showAutoIndicator?: boolean

    /**
     * Initial selections to pre-populate levels.
     * Array of entity IDs matching hierarchy levels (e.g., [workflowId, variantId, revisionId]).
     * Null entries are skipped.
     */
    initialSelections?: (string | null)[]
}

// ============================================================================
// BREADCRUMB VARIANT PROPS
// ============================================================================

/**
 * Props for breadcrumb variant (drill-down navigation style)
 *
 * Shows one hierarchy level at a time with breadcrumb navigation.
 * Users click items to drill down, and use breadcrumb to navigate up.
 */
export interface BreadcrumbVariantProps<
    TSelection = EntitySelectionResult,
> extends EntityPickerBaseProps<TSelection> {
    variant: "breadcrumb"

    /**
     * Override auto-select behavior per level.
     * Array of booleans matching hierarchy levels.
     */
    autoSelectByLevel?: (boolean | undefined)[]

    /**
     * Show breadcrumb navigation
     * @default true
     */
    showBreadcrumb?: boolean

    /**
     * Show back button when not at root
     * @default true
     */
    showBackButton?: boolean

    /**
     * Root label for breadcrumb (e.g., "All Apps")
     */
    rootLabel?: string

    /**
     * Optional content rendered on the right side of breadcrumb header row.
     * Useful for contextual actions (e.g., disconnect).
     */
    breadcrumbActions?: ReactNode

    /**
     * Maximum height for the list container
     * @default 400
     */
    maxHeight?: number | string

    /**
     * Auto-select when only one option is available
     * @default false
     */
    autoSelectSingle?: boolean

    // ========================================================================
    // INFINITE SCROLL PROPS
    // ========================================================================

    /**
     * Enable infinite scroll with virtual list.
     * Uses pagination from adapter if available.
     * @default false
     */
    infiniteScroll?: boolean

    /**
     * Page size for infinite scroll
     * @default 50
     */
    pageSize?: number

    /**
     * Show "Load More" button instead of auto-loading on scroll.
     * Only applies when infiniteScroll is true.
     * @default false
     */
    loadMoreButton?: boolean

    /**
     * Show "Load All" button to fetch all remaining pages.
     * Only applies when infiniteScroll is true.
     * @default false
     */
    showLoadAll?: boolean

    /**
     * Estimated item height for virtual list (pixels)
     * @default 48
     */
    estimatedItemHeight?: number
}

// ============================================================================
// LIST-POPOVER VARIANT PROPS
// ============================================================================

/**
 * Props for list-popover variant (Testset → Revision style)
 *
 * Shows a vertical list of parent entities with hover/click popovers
 * for selecting child entities. Designed for 2-level hierarchies.
 */
export interface ListPopoverVariantProps<
    TSelection = EntitySelectionResult,
> extends EntityPickerBaseProps<TSelection> {
    variant: "list-popover"

    /**
     * Currently selected parent entity ID (for highlighting)
     */
    selectedParentId?: string | null

    /**
     * Currently selected child entity ID (for highlighting)
     */
    selectedChildId?: string | null

    /**
     * Auto-select first parent on mount if none selected
     * @default false
     */
    autoSelectFirst?: boolean

    /**
     * Auto-select the latest (first) child of the first parent on mount.
     * Triggers onSelect with the first parent's first child.
     * @default false
     */
    autoSelectLatest?: boolean

    /**
     * When true, clicking a parent will automatically select its latest (first) child.
     * @default false
     */
    selectLatestOnParentClick?: boolean

    /**
     * Set of parent IDs that should be disabled (grayed out, not selectable)
     */
    disabledParentIds?: Set<string>

    /**
     * Tooltip message to show on disabled parents
     */
    disabledTooltip?: string

    /**
     * Set of child IDs that should be disabled (grayed out, not selectable)
     */
    disabledChildIds?: Set<string>

    /**
     * Tooltip message to show on disabled children
     */
    disabledChildTooltip?: string

    /**
     * Popover placement
     * @default "rightTop"
     */
    popoverPlacement?: "right" | "rightTop" | "rightBottom" | "left" | "leftTop" | "leftBottom"

    /**
     * Popover trigger
     * @default "hover"
     */
    popoverTrigger?: "hover" | "click"

    /**
     * Maximum height for the parent list
     * @default 400
     */
    maxHeight?: number | string

    /**
     * Callback when a parent entity is hovered (for preloading)
     */
    onParentHover?: (parentId: string) => void

    /**
     * Optional section label rendered between the search bar and the parent list.
     * When provided, a horizontal divider and this label are shown (e.g., "Test sets").
     * When omitted, no divider or label is rendered (backwards-compatible).
     */
    sectionLabel?: string
}

// ============================================================================
// TREE-SELECT VARIANT PROPS
// ============================================================================

/**
 * Action handler for custom actions on tree items
 */
export interface TreeSelectItemAction {
    /** Unique key for the action */
    key: string
    /** Action handler - receives the item and mouse event */
    handler: (item: unknown, event: React.MouseEvent) => void
    /** Whether to show this action for the item */
    shouldShow?: (item: unknown) => boolean
}

/**
 * Props for tree-select variant (Variant → Revision style)
 *
 * Renders an Ant Design TreeSelect with expandable parent groups
 * containing selectable children. Designed for 2-level hierarchies.
 */
export interface TreeSelectVariantProps<
    TSelection = EntitySelectionResult,
> extends EntityPickerBaseProps<TSelection> {
    variant: "tree-select"

    /**
     * Currently selected value (child ID)
     */
    selectedValue?: string | null

    /**
     * Set of parent IDs that should be disabled
     */
    disabledParentIds?: Set<string>

    /**
     * Set of child IDs that should be disabled
     */
    disabledChildIds?: Set<string>

    /**
     * Custom actions for child items (e.g., "Create local copy", "Discard")
     */
    childActions?: TreeSelectItemAction[]

    /**
     * Custom actions for parent items
     */
    parentActions?: TreeSelectItemAction[]

    /**
     * Custom title renderer for parent nodes
     */
    renderParentTitle?: (parent: unknown, defaultNode: React.ReactNode) => React.ReactNode

    /**
     * Custom title renderer for child nodes
     */
    renderChildTitle?: (
        child: unknown,
        parent: unknown,
        defaultNode: React.ReactNode,
    ) => React.ReactNode

    /**
     * Custom renderer for the selected label (value display).
     */
    renderSelectedLabel?: (
        child: unknown,
        parent: unknown,
        defaultNode: React.ReactNode,
    ) => React.ReactNode

    /**
     * Whether to expand all nodes by default
     * @default true
     */
    defaultExpandAll?: boolean

    /**
     * Filter function for parents (in addition to search)
     */
    parentFilter?: (parent: unknown) => boolean

    /**
     * Filter function for children (in addition to search)
     */
    childFilter?: (child: unknown, parent: unknown) => boolean

    /**
     * TreeSelect component size
     * @default "small"
     */
    size?: "small" | "middle" | "large"

    /**
     * Placeholder text
     * @default "Select..."
     */
    placeholder?: string

    /**
     * Dropdown style override
     */
    dropdownStyle?: React.CSSProperties

    /**
     * Dropdown className
     */
    dropdownClassName?: string

    /**
     * Tree node label prop
     * @default "label"
     */
    treeNodeLabelProp?: string

    /**
     * Whether popup width matches select width
     * @default false
     */
    popupMatchSelectWidth?: boolean

    /**
     * Minimum popup width
     * @default 280
     */
    popupMinWidth?: number

    /**
     * Maximum height for the dropdown
     * @default 400
     */
    maxHeight?: number

    /**
     * Custom header content in popup (rendered below search row)
     */
    popupHeader?: React.ReactNode

    /**
     * Action element rendered inline with search input (e.g., "Create new" button)
     * Displayed to the right of the search input in the same row.
     */
    popupHeaderAction?: React.ReactNode

    /**
     * Custom footer content in popup
     */
    popupFooter?: React.ReactNode
}

// ============================================================================
// CASCADER VARIANT PROPS
// ============================================================================

/**
 * Props for cascader variant (single compact dropdown with cascading panels)
 *
 * Renders an Ant Design Cascader with lazy-loaded panels.
 * All hierarchy levels are navigable within one dropdown.
 * Pattern: Evaluator → Variant → Revision (all in one dropdown)
 */
export interface CascaderVariantProps<
    TSelection = EntitySelectionResult,
> extends EntityPickerBaseProps<TSelection> {
    variant: "cascader"

    /**
     * Cascader component size
     * @default "middle"
     */
    size?: "small" | "middle" | "large"

    /**
     * Placeholder text
     * @default "Select..."
     */
    placeholder?: string

    /**
     * Whether popup width matches select width
     * @default false
     */
    popupMatchSelectWidth?: boolean

    /**
     * Popup className
     */
    popupClassName?: string

    /**
     * Popup placement
     */
    placement?: "bottomLeft" | "bottomRight" | "topLeft" | "topRight"

    /**
     * Custom dropdown render for adding extra content (e.g., footer actions)
     */
    dropdownRender?: (menu: ReactNode) => ReactNode

    /**
     * Custom display render for the selected value in the input
     */
    displayRender?: (labels: string[], selectedOptions?: unknown[]) => ReactNode
}

// ============================================================================
// POPOVER-CASCADER VARIANT PROPS
// ============================================================================

/**
 * Props for popover-cascader variant (button-triggered popover with cascading panels)
 *
 * Renders a trigger Button that opens an Ant Design Popover containing
 * side-by-side cascading panels. The left panel shows root items with search,
 * the right panel shows children when a root item is selected.
 *
 * Designed for use cases where a button trigger is preferred over a select input.
 */
export interface PopoverCascaderVariantProps<
    TSelection = EntitySelectionResult,
> extends EntityPickerBaseProps<TSelection> {
    variant: "popover-cascader"

    /**
     * Currently selected parent entity ID (for highlighting)
     */
    selectedParentId?: string | null

    /**
     * Currently selected child entity ID (for highlighting)
     */
    selectedChildId?: string | null

    /**
     * Trigger button size
     * @default "small"
     */
    size?: "small" | "middle" | "large"

    /**
     * Button text
     * @default "Select..."
     */
    placeholder?: string

    /**
     * Icon rendered inside the trigger button (before the text)
     */
    icon?: ReactNode

    /**
     * Whether to render the dropdown chevron on the trigger button.
     * @default true
     */
    showDropdownIcon?: boolean

    /**
     * Popover placement
     * @default "bottomLeft"
     */
    placement?: "bottomLeft" | "bottomRight" | "topLeft" | "topRight"

    /**
     * Minimum width of each cascading panel (px)
     * @default 220
     */
    panelMinWidth?: number

    /**
     * Maximum height of item lists (px)
     * @default 340
     */
    maxHeight?: number

    /**
     * Footer content rendered at the bottom of the root panel.
     * Typically used for "Disconnect all" buttons.
     */
    popupFooter?: ReactNode

    /**
     * Callback when the "+ New" button is clicked.
     * When provided, a create button is rendered below the root list.
     */
    onCreateNew?: () => void

    /**
     * Custom label for the create button.
     * Falls back to "+ New {rootLevelLabel}" if not provided.
     */
    createNewLabel?: string

    /**
     * Set of child-level entity IDs that should be disabled (already selected).
     * These items appear grayed out with a tooltip in the child panel.
     */
    disabledChildIds?: Set<string>

    /**
     * Tooltip text shown on disabled child items.
     * @default "Already connected"
     */
    disabledChildTooltip?: string

    /**
     * Opens the child panel when hovering a parent item.
     * @default false
     */
    openChildOnHover?: boolean

    // ========================================================================
    // MULTI-SELECT
    // ========================================================================

    /**
     * Enable multi-select mode in the child panel.
     * When true, children render with checkboxes instead of click-to-select.
     * The popover stays open after each toggle (user closes manually).
     * @default false
     */
    multiSelect?: boolean

    /**
     * Controlled set of selected child IDs (for multi-select mode).
     * The component renders checkboxes as checked for IDs in this set.
     * In multi-select mode, this takes precedence over `selectedChildId`.
     */
    selectedChildIds?: Set<string>

    /**
     * Controls the rendering mode for child item labels.
     * - "full": Render using `labelNode` from adapter (if available), which may contain avatars/metadata.
     * - "simple": Force render using simple string label, ignoring `labelNode`.
     * @default "full"
     */
    childItemLabelMode?: "full" | "simple"

    // ========================================================================
    // SELECTION SUMMARY
    // ========================================================================

    /**
     * Whether to display an internally generated selection summary above the root item list.
     * The picker derives the summary text from the current selection state.
     * @default false
     */
    selectionSummary?: boolean
}

// ============================================================================
// UNION TYPE
// ============================================================================

/**
 * Union type for all EntityPicker props
 */
export type EntityPickerProps<TSelection = EntitySelectionResult> =
    | CascadingVariantProps<TSelection>
    | CascaderVariantProps<TSelection>
    | BreadcrumbVariantProps<TSelection>
    | ListPopoverVariantProps<TSelection>
    | TreeSelectVariantProps<TSelection>
    | CascaderVariantProps<TSelection>
    | PopoverCascaderVariantProps<TSelection>
