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

// ============================================================================
// SELECT COMPONENTS
// ============================================================================

export {SimpleDropdownSelect, type SimpleDropdownSelectProps, type DropdownMenuItem} from "./select"

// ============================================================================
// METADATA COMPONENTS
// ============================================================================

export {MetadataHeader, type MetadataHeaderProps} from "./metadata"

// ============================================================================
// ATTACHMENT COMPONENTS
// ============================================================================

export {
    ImageAttachment,
    FileAttachment,
    AttachmentGrid,
    type ImageAttachmentProps,
    type FileAttachmentProps,
    type AttachmentGridProps,
} from "./attachments"

// ============================================================================
// FIELD COMPONENTS
// ============================================================================

export {FieldHeader, type FieldHeaderProps} from "./field"

// ============================================================================
// EDITABLE COMPONENTS
// ============================================================================

export {EditableText, type EditableTextProps} from "./editable"

// ============================================================================
// STATUS COMPONENTS
// ============================================================================

export {
    StatusTag,
    getStatusColor,
    getStatusLabel,
    type StatusTagProps,
    type QueryStatus,
    type ExecutionStatus,
} from "./status"

// ============================================================================
// ENTITY ICON LABEL COMPONENTS
// ============================================================================

export {
    EntityIconLabel,
    PanelHeader,
    type EntityIconLabelProps,
    type PanelHeaderProps,
} from "./entity-icon-label"

// ============================================================================
// SOURCE INDICATOR COMPONENTS
// ============================================================================

export {SourceIndicator, type SourceIndicatorProps} from "./source-indicator"

// ============================================================================
// INPUT COMPONENTS
// ============================================================================

export {SliderInput, LabeledField, type SliderInputProps, type LabeledFieldProps} from "./inputs"

// ============================================================================
// SKELETON COMPONENTS
// ============================================================================

export {ListItemSkeleton, type ListItemSkeletonProps} from "./skeleton"

// ============================================================================
// LAYOUT COMPONENTS
// ============================================================================

export {
    SplitPanelLayout,
    NumberedStep,
    StepContainer,
    PanelFooter,
    type SplitPanelLayoutProps,
    type NumberedStepProps,
    type StepContainerProps,
    type PanelFooterProps,
} from "./layout"

// ============================================================================
// TABLE STATE COMPONENTS
// ============================================================================

export {
    TableLoadingState,
    TableEmptyState,
    CollapsibleGroupHeader,
    type TableLoadingStateProps,
    type TableEmptyStateProps,
    type CollapsibleGroupHeaderProps,
} from "./table-states"
