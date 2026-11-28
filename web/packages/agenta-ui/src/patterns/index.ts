/**
 * @agenta/ui Components
 *
 * Reusable UI components for building interfaces.
 *
 * ## Available Component Groups
 *
 * ### Selection Components
 * Components for building list selection UIs with search, virtual scrolling,
 * and pagination.
 *
 * ### Presentational Components
 * Pure UI components for displaying entity information, versions, and labels.
 *
 * @example
 * ```typescript
 * import {
 *   // Selection
 *   SearchInput,
 *   ListItem,
 *   VirtualList,
 *   LoadMoreButton,
 *   EntityBreadcrumb,
 *
 *   // Presentational
 *   VersionBadge,
 *   RevisionLabel,
 *   EntityPathLabel,
 *   EntityNameWithVersion,
 * } from '@agenta/ui'
 * ```
 */

// ============================================================================
// SELECTION COMPONENTS
// ============================================================================

export * from "./selection"

// ============================================================================
// PRESENTATIONAL COMPONENTS
// ============================================================================

export * from "./presentational"

// ============================================================================
// ACTION COMPONENTS
// ============================================================================

export {
    DropdownButton,
    type DropdownButtonOption,
    type DropdownButtonOptionStatus,
    type DropdownButtonProps,
} from "./DropdownButton"

export {HeightCollapse, type HeightCollapseProps} from "../layout/HeightCollapse"

// ============================================================================
// LAYOUT COMPONENTS
// ============================================================================

export {default as PageLayout, type PageLayoutProps} from "../layout/PageLayout"

export {pageContentWidthClass, pageGutterClass} from "../layout/pageWidth"

export {EntityCard, type EntityCardProps} from "./EntityCard"

// ============================================================================
// SCROLL COMPONENTS
// ============================================================================

export {default as ScrollSentinel} from "../layout/ScrollSentinel"
export {default as ScrollToTopButton} from "../layout/ScrollToTopButton"
