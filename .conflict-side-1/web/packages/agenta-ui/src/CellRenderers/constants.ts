/**
 * Shared constants for cell content rendering
 */

// Default max lines for cell preview based on row height
// Small (80px): ~4 lines, Medium (160px): ~10 lines, Large (280px): ~18 lines
export const DEFAULT_MAX_LINES = 10

// Max characters for cell preview - prevents rendering huge text blocks
export const MAX_CELL_CHARS = 500

// JSON syntax highlighting class
// Keep default/inherited text color to avoid visual bias in mixed-content tables.
export const JSON_HIGHLIGHT_CLASS = "text-inherit"

// Chat message role colors - using Ant Design semantic color tokens
// Maps role names to Tailwind classes based on the design system
export const ROLE_COLOR_CLASSES: Record<string, string> = {
    user: "text-blue-6", // colorInfo
    assistant: "text-green-6", // colorSuccess
    system: "text-gold-6", // colorWarning
    function: "text-purple-6", // purple semantic
    tool: "text-magenta-6", // magenta semantic
}

// Default role color class for unknown roles
export const DEFAULT_ROLE_COLOR_CLASS = "text-inherit"
