/**
 * Shared cell content renderers for table cells
 *
 * These components provide optimized, consistent rendering for testcase/scenario data
 * across different tables (TestcasesTable, EvalRunDetails scenarios table, etc.)
 *
 * Key optimizations:
 * - Plain text rendering instead of heavy editor components
 * - Truncation for cell preview (lines + characters)
 * - Full content in popover on hover
 * - Memoization for performance
 *
 * NOTE: These are re-exported from @agenta/ui for backward compatibility.
 * New code should import directly from @agenta/ui.
 */

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
} from "@agenta/ui"
