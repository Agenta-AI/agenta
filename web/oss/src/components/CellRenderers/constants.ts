/**
 * Shared constants for cell content rendering
 */

// Default max lines for cell preview based on row height
// Small (80px): ~4 lines, Medium (160px): ~10 lines, Large (280px): ~18 lines
export const DEFAULT_MAX_LINES = 10

// Max characters for cell preview - prevents rendering huge text blocks
export const MAX_CELL_CHARS = 500

// JSON syntax highlighting color
export const JSON_HIGHLIGHT_COLOR = "#9d4edd"

// Chat message role colors
export const ROLE_COLORS: Record<string, string> = {
    user: "#3b82f6",
    assistant: "#10b981",
    system: "#f59e0b",
    function: "#8b5cf6",
    tool: "#ec4899",
}
