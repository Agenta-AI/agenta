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
 * ### Modal Components
 * Enhanced modal wrappers and utilities.
 *
 * @example
 * ```typescript
 * import {
 *   // Selection
 *   SearchInput,
 *   ListItem,
 *   VirtualList,
 *   LoadMoreButton,
 *   Breadcrumb,
 *
 *   // Presentational
 *   VersionBadge,
 *   RevisionLabel,
 *   EntityPathLabel,
 *   EntityNameWithVersion,
 *
 *   // Modal
 *   EnhancedModal,
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
// MODAL COMPONENTS
// ============================================================================

export {EnhancedModal, type EnhancedModalProps, type EnhancedModalStyles} from "./EnhancedModal"
export {ModalContent, ModalFooter, type ModalContentProps, type ModalFooterProps} from "./modal"

// ============================================================================
// ACTION COMPONENTS
// ============================================================================

export {
    CopyButtonDropdown,
    type CopyButtonDropdownProps,
    type CopyOption,
} from "./CopyButtonDropdown"

export {
    DropdownButton,
    type DropdownButtonOption,
    type DropdownButtonOptionStatus,
    type DropdownButtonProps,
} from "./DropdownButton"

export {DraftTag, type DraftTagProps} from "./DraftTag"
export {HeightCollapse, type HeightCollapseProps} from "./HeightCollapse"
export {SyncStateTag, type SyncState, type SyncStateTagProps} from "./SyncStateTag"

// ============================================================================
// SCROLL COMPONENTS
// ============================================================================

export {default as ScrollSentinel} from "./ScrollSentinel"
export {default as ScrollToTopButton} from "./ScrollToTopButton"
