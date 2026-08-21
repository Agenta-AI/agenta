/**
 * Tool Utilities
 *
 * Shared constants and types for tool rendering in entity-ui.
 * Contains provider metadata and builtin tool specs for detecting
 * provider-specific tools (OpenAI, Anthropic, Google Gemini).
 */
import {parseGatewayToolSlug} from "@agenta/shared/utils"

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

export interface GatewayToolParsed {
    provider: string
    integration: string
    action: string
    connection: string
}

/** @deprecated alias — use parseGatewayToolSlug (shared) or parseGatewayTool (object-level). */
export const parseGatewayFunctionName = parseGatewayToolSlug

/** Normalized view of a connected-app tool from either encoding; null if it isn't one. */
export interface ParsedGatewayTool {
    provider: string
    integration: string
    action: string
    connection: string
    /** Encoding it was read from — protocol context only; never displayed or persisted. */
    encoding: "canonical" | "legacy"
    /** Per-tool permission when present (top-level on both shapes). */
    permission?: string
}

/**
 * A connection-level toolkit entry (`{type: "gateway_toolkit"}`): one config item that grants a
 * whole connected app instead of one entry per action. It resolves server-side into a search and an
 * execute meta-tool. `mode: "all"` allows every action; `mode: "include"` limits to `actions`.
 */
export interface ParsedGatewayToolkit {
    provider: string
    integration: string
    connection: string
    mode: "all" | "include"
    /** Allowed Agenta action keys — only meaningful when `mode === "include"`. */
    actions: string[]
    /** Per-entry permission default (top-level, same slot as a per-action gateway tool). */
    permission?: string
}

/** Normalize a `gateway_toolkit` entry into one view; null if it isn't one. */
export function parseGatewayToolkit(tool: unknown): ParsedGatewayToolkit | null {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return null
    const t = tool as Record<string, unknown>
    if (t.type !== "gateway_toolkit") return null
    const integration = typeof t.integration === "string" ? t.integration : ""
    const connection = typeof t.connection === "string" ? t.connection : ""
    if (!integration || !connection) return null
    const provider = typeof t.provider === "string" && t.provider ? t.provider : "composio"
    const policy =
        t.tools && typeof t.tools === "object" && !Array.isArray(t.tools)
            ? (t.tools as Record<string, unknown>)
            : {}
    const mode = policy.mode === "include" ? "include" : "all"
    const actions = Array.isArray(policy.actions)
        ? policy.actions.filter((a): a is string => typeof a === "string")
        : []
    const permission = typeof t.permission === "string" ? t.permission : undefined
    return {provider, integration, connection, mode, actions, permission}
}

/** Build a `gateway_toolkit` config entry from a drawer selection (the persisted contract). */
export function buildGatewayToolkit(input: {
    provider: string
    integration: string
    connection: string
    mode: "all" | "include"
    actions?: string[]
    permission?: string
}): Record<string, unknown> {
    return {
        type: "gateway_toolkit",
        provider: input.provider || "composio",
        integration: input.integration,
        connection: input.connection,
        tools:
            input.mode === "include"
                ? {mode: "include", actions: input.actions ?? []}
                : {mode: "all"},
        ...(input.permission ? {permission: input.permission} : {}),
    }
}

/** Normalize either encoding of a connected-app tool into one view. */
export function parseGatewayTool(tool: unknown): ParsedGatewayTool | null {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return null
    const t = tool as Record<string, unknown>
    const permission = typeof t.permission === "string" ? t.permission : undefined
    // Canonical discriminated object.
    if (t.type === "gateway") {
        const integration = typeof t.integration === "string" ? t.integration : ""
        const action = typeof t.action === "string" ? t.action : ""
        const connection = typeof t.connection === "string" ? t.connection : ""
        if (!integration || !action || !connection) return null
        const provider = typeof t.provider === "string" && t.provider ? t.provider : "composio"
        return {provider, integration, action, connection, encoding: "canonical", permission}
    }
    // Legacy function-name slug.
    const fn = t.function
    const name = fn && typeof fn === "object" ? (fn as Record<string, unknown>).name : undefined
    const parsed = parseGatewayToolSlug(typeof name === "string" ? name : undefined)
    if (parsed) return {...parsed, encoding: "legacy", permission}
    return null
}

/**
 * A legacy harness built-in entry (`{type: "builtin", name}`). Harness built-ins are always
 * active and are no longer configured, so a saved config that still carries one renders nowhere.
 * Provider built-ins (`{type: "web_search_preview"}`) are a different concept and are excluded.
 */
export function isHarnessBuiltinTool(tool: unknown): boolean {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false
    return (tool as Record<string, unknown>).type === "builtin"
}

// NUL join — a connection slug can contain a dot, so a dotted key is not collision-safe.
const GATEWAY_IDENTITY_SEP = "\u0000"

/** Stable identity for the drawer's added-state, independent of encoding. Excludes
 *  permission (policy, not identity) and encoding. */
export function gatewayToolIdentity(view: ParsedGatewayTool): string {
    return [view.provider, view.integration, view.action, view.connection].join(
        GATEWAY_IDENTITY_SEP,
    )
}

/** Stable identity for a `gateway_toolkit` entry (one per connection). The `toolkit` prefix keeps it
 *  disjoint from a per-action identity, so a toolkit and an action never collide in the added-set. */
export function gatewayToolkitIdentity(view: {
    provider: string
    integration: string
    connection: string
}): string {
    return ["toolkit", view.provider, view.integration, view.connection].join(GATEWAY_IDENTITY_SEP)
}

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
