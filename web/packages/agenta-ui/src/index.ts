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
 * - textColors: Semantic text color classes (using Ant Design zinc scale)
 * - bgColors: Semantic background color classes
 * - borderColors: Semantic border color classes
 * - interactiveStyles: Common interactive element styles
 * - statusColors: Status-based color classes (success, warning, error, info)
 * - shadows: Common shadow classes
 */
export {
    cn,
    sizeClasses,
    flexLayouts,
    textColors,
    bgColors,
    borderColors,
    interactiveStyles,
    statusColors,
    shadows,
    type SizeVariant,
} from "./utils/styles"

/**
 * App Message Context - Static exports for Ant Design message/modal/notification
 *
 * Render AppMessageContext inside your Ant Design App provider, then use
 * the static message/modal/notification exports anywhere.
 */
export {default as AppMessageContext, message, modal, notification} from "./utils/appMessageContext"

// ============================================================================
// LLM ICONS - SVG icons for LLM providers
// ============================================================================

export {
    // Icon Map
    LLMIconMap,
    // Individual Icons
    AlephAlpha,
    Anthropic,
    AnyScale,
    Azure,
    Bedrock,
    Cerebus,
    DeepInfra,
    Fireworks,
    Gemini,
    Groq,
    Lepton,
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
} from "./LLMIcons"

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
} from "./SelectLLMProvider"

// ============================================================================
// EDITOR - Rich text and code editor built on Lexical
// ============================================================================

export {
    // Main components
    Editor,
    EditorProvider,
    DiffView,
    // Re-exports from Lexical
    useLexicalComposerContext,
    ON_HYDRATE_FROM_REMOTE_CONTENT,
    // State
    EditorStateProvider,
    editorStateAtom,
    markdownViewAtom,
    // Code editor utilities
    createHighlightedNodes,
    TOGGLE_FORM_VIEW,
    DRILL_IN_TO_PATH,
    ON_CHANGE_LANGUAGE,
    PropertyClickPlugin,
    $getEditorCodeAsString,
    tryParsePartialJson,
    safeJson5Parse,
    // Drill-in context for Editor integration
    DrillInProvider,
    // Markdown utilities
    TOGGLE_MARKDOWN_VIEW,
    ON_CHANGE_COMMAND,
    $convertToMarkdownStringCustom,
    PLAYGROUND_TRANSFORMERS,
    // Hooks
    useEditorConfig,
    useEditorInvariant,
    useEditorResize,
    // Commands
    INITIAL_CONTENT_COMMAND,
    // Types
    type EditorProps,
    type EditorPluginsProps,
    type EditorContextType,
    type EditorProviderProps,
    type InitialContentPayload,
    type CustomRenderFn,
} from "./Editor"

// ============================================================================
// SHARED EDITOR - Editor wrapper with debounce and styling
// ============================================================================

export {
    SharedEditor,
    useDebounceInput,
    type SharedEditorProps,
    type BaseContainerProps,
} from "./SharedEditor"

// ============================================================================
// CHAT MESSAGE - Chat message editing components and utilities
// ============================================================================

export {
    // Types
    type TextContentPart,
    type ImageContentPart,
    type FileContentPart,
    type MessageContentPart,
    type MessageContent,
    type ToolCall,
    type SimpleChatMessage,
    // Schemas
    MESSAGE_CONTENT_SCHEMA,
    CHAT_MESSAGE_SCHEMA,
    CHAT_MESSAGES_ARRAY_SCHEMA,
    // Utilities
    extractTextFromContent,
    extractDisplayTextFromMessage,
    hasAttachments,
    getAttachmentInfo,
    updateTextInContent,
    addImageToContent,
    addFileToContent,
    removeAttachmentFromContent,
    getAttachments,
    // Components
    ChatMessageEditor,
    ChatMessageList,
    MarkdownToggleButton,
    ToolMessageHeader,
    MessageAttachments,
    AttachmentButton,
    SimpleDropdownSelect,
    // Component Types
    type ChatMessageEditorProps,
    type ChatMessageListProps,
    type SimpleDropdownSelectProps,
} from "./ChatMessage"
