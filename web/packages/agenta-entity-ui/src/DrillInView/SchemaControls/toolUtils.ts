/**
 * Tool Utilities
 *
 * Shared constants and types for tool rendering in entity-ui.
 * Contains provider metadata and builtin tool specs for detecting
 * provider-specific tools (OpenAI, Anthropic, Google Gemini).
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ToolFunction {
    name?: string
    description?: string
    [k: string]: unknown
}

export type ToolObj = {
    function?: ToolFunction
    [k: string]: unknown
} | null

// ============================================================================
// PROVIDER METADATA
// ============================================================================

export const TOOL_PROVIDERS_META: Record<string, {label: string; iconKey?: string}> = {
    openai: {label: "OpenAI", iconKey: "OpenAI"},
    anthropic: {label: "Anthropic", iconKey: "Anthropic"},
    google: {label: "Google Gemini", iconKey: "Google Gemini"},
}

// ============================================================================
// BUILTIN TOOL SPECS
// ============================================================================

/**
 * Provider-organized reference for matching builtin tools.
 * Each provider maps tool codes to arrays of payload patterns.
 *
 * Matching priority:
 * 1. `type` field (most specific, e.g., "web_search_preview")
 * 2. `name` field (e.g., "bash")
 * 3. Single unique provider key (e.g., Google's {code_execution: {}})
 */
export const TOOL_SPECS: Record<string, Record<string, Record<string, unknown>[]>> = {
    openai: {
        web_search: [{type: "web_search_preview"}],
        file_search: [
            {
                type: "file_search",
                vector_store_ids: ["vs_SET_VECTOR_STORE_ID"],
                max_num_results: 10,
            },
        ],
    },
    anthropic: {
        bash_scripting: [{type: "bash_20250124", name: "bash"}],
        web_search: [{type: "web_search_20250305", name: "web_search"}],
    },
    google: {
        code_execution: [{code_execution: {}}],
        web_search: [{googleSearch: {}}],
    },
}
