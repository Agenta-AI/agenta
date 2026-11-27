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
 * - Selection components (SearchInput, VirtualList, EntityBreadcrumb, etc.)
 * - Presentational components (VersionBadge, RevisionLabel, EntityPathLabel, etc.)
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
 * } from '@agenta/ui'
 *
 * // Import utilities
 * import { copyToClipboard, cn } from '@agenta/ui'
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
export * from "./data/infinite-virtual-table"

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * All component exports including:
 * - Selection: SearchInput, ListItem, VirtualList, LoadMoreButton, LoadAllButton, EntityBreadcrumb
 * - Presentational: VersionBadge, RevisionLabel, EntityPathLabel, EntityNameWithVersion
 */
export * from "./patterns"

// ============================================================================
// UTILITIES
// ============================================================================

export {copyToClipboard} from "./foundation/utils/copyToClipboard"

/**
 * Column grouping utilities for tables:
 * - groupColumns: Transform flat columns into grouped/nested columns for Ant Design tables
 * - isGroupedColumnKey: Check if a column key contains a group separator
 * - parseGroupedColumnKey: Parse a grouped key into group name and column name
 * - getLeafColumnName: Get the leaf name from a nested column key
 */
export {
    groupColumns,
    isGroupedColumnKey,
    parseGroupedColumnKey,
    getLeafColumnName,
    type GroupableColumn,
    type GroupColumnsOptions,
} from "./data/infinite-virtual-table/utils/groupColumns"

/**
 * Styling utilities: `cn` (the tailwind-merge class combiner) and the shared layout sizes.
 */
export {cn, layoutSizes, modalSizes, type SizeVariant} from "./foundation/utils/styles"

/**
 * App Message Context - Static message/modal/notification services
 *
 * Render AppMessageContext once anywhere in the app tree (it needs no provider and portals
 * its own surfaces to document.body), then use the static message/modal/notification
 * exports anywhere — including outside React.
 */
export {
    default as AppMessageContext,
    message,
    modal,
    notification,
} from "./composed/feedback/appMessageContext"

// ============================================================================
// LLM ICONS - SVG icons for LLM providers
// ============================================================================

export {
    // Icon Map
    LLMIconMap,
    // Individual Icons
    AlephAlpha,
    Claude,
    AnyScale,
    Azure,
    Bedrock,
    Cerebus,
    DeepInfra,
    Fireworks,
    Gemini,
    Groq,
    Lepton,
    MiniMax,
    Mistral,
    OpenAi,
    OpenRouter,
    Perplexity,
    Replicate,
    Sagemaker,
    Together,
    Vertex,
    XAI,
    // Types
    type IconProps,
} from "./icons/llm-icons"

// ============================================================================
// SELECT LLM PROVIDER - Provider selection component
// ============================================================================

export {
    SelectLLMProviderBase,
    // Types
    type SelectLLMProviderBaseProps,
    type ProviderOption,
    type ProviderGroup,
    // Utilities
    capitalize,
    PROVIDER_ICON_MAP,
    getProviderIcon,
    getProviderDisplayName,
} from "./patterns/select-llm-provider"

// ============================================================================
// HOOKS - Shared React hooks
// ============================================================================

export {useSelectionState, type UseSelectionStateResult} from "./foundation/hooks"
export {useDefaultStoreAtomValue} from "./foundation/hooks"

// ============================================================================
// COPY TOOLTIP - Tooltip with click-to-copy functionality
// ============================================================================

export {CopyTooltip, type CopyTooltipProps} from "./composed/feedback/copy-tooltip"

// ============================================================================
// CELL RENDERERS - Smart cell content rendering for tables
// ============================================================================

export {
    // Components
    CellContentPopover,
    JsonCellContent,
    TextCellContent,
    ChatMessagesCellContent,
    SmartCellContent,
    // Utilities
    truncateToLines,
    truncateToChars,
    truncateContent,
    safeJsonStringify,
    tryParseJson,
    normalizeValue,
    isChatMessagesArray,
    extractChatMessages,
    normalizeChatMessages,
    // Constants
    DEFAULT_MAX_LINES,
    MAX_CELL_CHARS,
    JSON_HIGHLIGHT_CLASS,
    ROLE_COLOR_CLASSES,
    DEFAULT_ROLE_COLOR_CLASS,
    // Types
    type NormalizedChatMessage,
} from "./data/cell-renderers"
