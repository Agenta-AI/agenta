/**
 * @agenta/ui - Shared UI Components Package
 *
 * This package provides reusable UI components, hooks, and utilities
 * for building data-intensive interfaces.
 *
 * ## Main Modules
 *
 * ### InfiniteVirtualTable
 * High-performance virtualized table with infinite scroll, column visibility,
 * row selection, and paginated data loading.
 *
 * ### Components
 * Reusable UI components including:
 * - Selection components (SearchInput, VirtualList, Breadcrumb, etc.)
 * - Presentational components (VersionBadge, RevisionLabel, EntityPathLabel, etc.)
 * - Modal utilities (EnhancedModal)
 *
 * ### Utilities
 * Generic utilities for clipboard operations, styling, and other common tasks.
 *
 * @example
 * ```typescript
 * // Import table components
 * import {
 *   InfiniteVirtualTable,
 *   useTableManager,
 *   createPaginatedEntityStore,
 * } from '@agenta/ui'
 *
 * // Import UI components
 * import {
 *   SearchInput,
 *   VirtualList,
 *   VersionBadge,
 *   RevisionLabel,
 *   EnhancedModal,
 * } from '@agenta/ui'
 *
 * // Import utilities
 * import { copyToClipboard, cn, sizeClasses } from '@agenta/ui'
 * ```
 */

// ============================================================================
// INFINITE VIRTUAL TABLE
// ============================================================================

/**
 * All table-related exports including:
 * - InfiniteVirtualTable component
 * - Table store factories (createInfiniteTableStore, createPaginatedEntityStore)
 * - Column utilities (createTableColumns, createStandardColumns)
 * - Hooks (useTableManager, useTableActions, useRowHeight, etc.)
 * - Types and helpers
 */
export * from "./InfiniteVirtualTable"

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * All component exports including:
 * - Selection: SearchInput, ListItem, VirtualList, LoadMoreButton, LoadAllButton, Breadcrumb
 * - Presentational: VersionBadge, RevisionLabel, EntityPathLabel, EntityNameWithVersion
 * - Modal: EnhancedModal
 */
export * from "./components"

// ============================================================================
// UTILITIES
// ============================================================================

export {copyToClipboard} from "./utils/copyToClipboard"

/**
 * Styling utilities:
 * - cn: Class name concatenation utility
 * - sizeClasses: Text size class mappings
 * - flexLayouts: Common flex layout patterns
 * - textColors: Semantic text color classes
 * - bgColors: Semantic background color classes
 * - borderColors: Semantic border color classes
 * - interactiveStyles: Common interactive element styles
 */
export {
    cn,
    sizeClasses,
    flexLayouts,
    textColors,
    bgColors,
    borderColors,
    interactiveStyles,
    type SizeVariant,
} from "./utils/styles"

/**
 * App Message Context - Static exports for Ant Design message/modal/notification
 *
 * Render AppMessageContext inside your Ant Design App provider, then use
 * the static message/modal/notification exports anywhere.
 */
export {default as AppMessageContext, message, modal, notification} from "./utils/appMessageContext"
