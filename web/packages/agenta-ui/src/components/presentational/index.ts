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
    // List item labels for entity selection
    EntityListItemLabel,
    EntityTypeIcon,
    type EntityListItemLabelProps,
    type EntityTypeIconProps,
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
    ConfigAccordionSection,
    sectionIndicatorColor,
    useAccordionSectionOpen,
    useRecentFlag,
    type SectionCardProps,
    type SectionHeaderRowProps,
    type SectionLabelProps,
    type ConfigBlockProps,
    type SectionSkeletonProps,
    type ConfigAccordionSectionProps,
    type SectionIndicatorTone,
} from "./section"

// ============================================================================
// COPY BUTTON
// ============================================================================

export {CopyButton, type CopyButtonProps} from "./CopyButton"

// ============================================================================
// ENHANCED BUTTON
// ============================================================================

export {default as EnhancedButton, type EnhancedButtonProps} from "./EnhancedButton"

// ============================================================================
// SELECT COMPONENTS
// ============================================================================

export {
    SimpleDropdownSelect,
    PathSelectorDropdown,
    type SimpleDropdownSelectProps,
    type DropdownMenuItem,
    type PathSelectorDropdownProps,
    type PathSelectorItem,
} from "./select"

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
    ImagePreview,
    ImageWithFallback,
    type ImageAttachmentProps,
    type FileAttachmentProps,
    type AttachmentGridProps,
    type ImagePreviewProps,
    type ImageWithFallbackProps,
    PromptImageUpload,
    type PromptImageUploadProps,
    type PromptUploadFile,
    PromptDocumentUpload,
    type PromptDocumentUploadProps,
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
// TAG — the one tag component (generic + domain presets). Absorbs StatusTag.
// ============================================================================

export {Tag, type TagProps, type SyncState} from "./tag"

// ============================================================================
// STATUS COMPONENTS
// ============================================================================

export {
    environmentColors,
    StatusIndicator,
    type StatusIndicatorProps,
    type StatusTone,
    type QueryStatus,
    type ExecutionStatus,
    type EnvironmentName,
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

export {
    SliderInput,
    CommitMessageInput,
    COMMIT_MESSAGE_MAX_LENGTH,
    LabelInput,
    type SliderInputProps,
    type CommitMessageInputProps,
    type LabelInputProps,
} from "./inputs"

// ============================================================================
// SKELETON COMPONENTS
// ============================================================================

export {LoadingSkeleton, type LoadingSkeletonProps} from "./skeleton"

// ============================================================================
// LAYOUT COMPONENTS
// ============================================================================

export {
    SplitPanelLayout,
    NumberedStep,
    PanelFooter,
    ModalContentLayout,
    PanelSurface,
    PanelScroll,
    PanelSection,
    PANEL_ACTION_CLASS,
    type SplitPanelLayoutProps,
    type NumberedStepProps,
    type PanelFooterProps,
    type ModalContentLayoutProps,
    type PanelSectionProps,
} from "./layout"

// ============================================================================
// TABLE STATE COMPONENTS
// ============================================================================

export {
    TableEmptyState,
    CollapsibleGroupHeader,
    type TableEmptyStateProps,
    type CollapsibleGroupHeaderProps,
} from "./table-states"

// ============================================================================
// METRICS COMPONENTS
// ============================================================================

export {
    ExecutionMetricsDisplay,
    type ExecutionMetricsDisplayProps,
    type ExecutionMetricsData,
} from "./metrics"

// ============================================================================
// DATE COMPONENTS
// ============================================================================

export {FormattedDate, type FormattedDateProps} from "./FormattedDate"

// ============================================================================
// AVATAR COMPONENTS
// ============================================================================

export {
    InitialsAvatar,
    getColorPairFromStr,
    getInitials,
    type InitialsAvatarProps,
    type ColorPair,
} from "./avatar"

// ============================================================================
// BUTTON COMPONENTS
// ============================================================================

export {
    RunButton,
    CollapseToggleButton,
    useCollapseToggle,
    useCollapseStyle,
    useContentOverflow,
    getCollapseIcon,
    getCollapseLabel,
    getCollapseStyle,
    DEFAULT_COLLAPSED_MAX_HEIGHT,
    type RunButtonProps,
    type CollapseToggleButtonProps,
    type UseCollapseToggleOptions,
    type UseCollapseToggleReturn,
} from "./buttons"
