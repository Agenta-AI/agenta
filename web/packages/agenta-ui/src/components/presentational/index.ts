/**
 * Presentational Components for Entity Display
 *
 * Reusable UI components for displaying entity information consistently
 * across different parts of the application. These are pure presentational
 * components with no data fetching or business logic.
 *
 * @example
 * ```typescript
 * import {
 *   VersionBadge,
 *   RevisionLabel,
 *   EntityPathLabel,
 *   EntityNameWithVersion,
 *   formatVersion,
 *   formatEntityWithVersion,
 * } from '@agenta/ui'
 * ```
 */

// ============================================================================
// VERSION COMPONENTS
// ============================================================================

export {VersionBadge, formatVersion, type VersionBadgeProps} from "./version"

// ============================================================================
// REVISION COMPONENTS
// ============================================================================

export {RevisionLabel, RevisionLabelInline, type RevisionLabelProps} from "./revision"

// ============================================================================
// ENTITY DISPLAY COMPONENTS
// ============================================================================

export {
    EntityPathLabel,
    buildEntityPath,
    formatEntityWithVersion,
    type EntityPathLabelProps,
    EntityNameWithVersion,
    EntityNameVersionText,
    type EntityNameWithVersionProps,
} from "./entity"

// ============================================================================
// SECTION LAYOUT COMPONENTS
// ============================================================================

export {
    SectionCard,
    SectionHeaderRow,
    SectionLabel,
    ConfigBlock,
    SectionSkeleton,
    type SectionCardProps,
    type SectionHeaderRowProps,
    type SectionLabelProps,
    type ConfigBlockProps,
    type SectionSkeletonProps,
} from "./section"

// ============================================================================
// COPY BUTTON
// ============================================================================

export {CopyButton, type CopyButtonProps} from "./CopyButton"
