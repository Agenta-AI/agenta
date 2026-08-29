/**
 * Tool Utilities
 *
 * Shared constants and types for tool rendering in entity-ui.
 * Contains provider metadata and builtin tool specs for detecting
 * provider-specific tools (OpenAI, Anthropic, Google Gemini).
 */
import type {
    GatewayConnectionToolConfig,
    GatewayPermission as WireGatewayPermission,
    ToolConnection,
} from "@agenta/entities/gatewayTool"
import {asRecord, parseGatewayToolSlug} from "@agenta/shared/utils"

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

// ============================================================================
// GATEWAY CONNECTION ENTRY (contracts section 1)
// ============================================================================

/**
 * The four values a connection policy holds, for the default and for one tool. Re-exported
 * from the generated client's wire type rather than restated, so a value added backend-side
 * fails to compile here instead of being silently dropped by the parser below.
 */
export type GatewayPermission = WireGatewayPermission

const GATEWAY_PERMISSIONS = new Set<string>([
    "inherit",
    "allow",
    "ask",
    "deny",
] satisfies GatewayPermission[])

export function isGatewayPermission(value: unknown): value is GatewayPermission {
    return typeof value === "string" && GATEWAY_PERMISSIONS.has(value)
}

/** `policy.permissions` of a saved `gateway_connection` entry. */
export interface GatewayConnectionPermissions {
    default: GatewayPermission
    tools: Record<string, GatewayPermission>
}

/** A whole integration the agent reaches through the gateway, with the policy authored for it. */
export interface ParsedGatewayConnection {
    provider: string
    integration: string
    /** The project connection slug the integration runs under. */
    connection: string
    permissions: GatewayConnectionPermissions
}

/** Names one integration entry. A revision holds at most one per provider and integration. */
export interface GatewayConnectionTarget {
    provider: string
    integration: string
}

/**
 * Read a `gateway_connection` entry, or null when the entry is not one. A tool key the provider
 * catalog no longer lists is kept verbatim — it is still an authored intent, and dropping it here
 * would silently rewrite the saved config on the next write.
 *
 * The three routing fields are REQUIRED, exactly as contracts section 1 fixes them. An entry
 * missing one is not repaired into a different entry: it fails to parse, renders as a raw row, and
 * is edited as JSON. The SDK refuses that same shape, so inventing a provider here would only hide
 * the problem until the agent runs.
 */
export function parseGatewayConnection(tool: unknown): ParsedGatewayConnection | null {
    const entry = asRecord(tool)
    if (!entry || entry.type !== "gateway_connection") return null
    const connection = asRecord(entry.connection)
    if (!connection) return null
    const provider = typeof connection.provider === "string" ? connection.provider : ""
    const integration = typeof connection.integration === "string" ? connection.integration : ""
    const slug = typeof connection.slug === "string" ? connection.slug : ""
    if (!provider || !integration || !slug) return null
    const permissions = asRecord(asRecord(entry.policy)?.permissions)
    const tools: Record<string, GatewayPermission> = {}
    const savedTools = asRecord(permissions?.tools)
    if (savedTools) {
        for (const [key, value] of Object.entries(savedTools)) {
            if (key && isGatewayPermission(value)) tools[key] = value
        }
    }
    return {
        provider,
        integration,
        connection: slug,
        permissions: {
            default: isGatewayPermission(permissions?.default) ? permissions.default : "inherit",
            tools,
        },
    }
}

/** The saved JSON for a connection entry — the reverse of {@link parseGatewayConnection}.
 *  Typed against the generated wire shape, so the writer cannot drift from the SDK model. */
export function buildGatewayConnectionEntry(
    view: ParsedGatewayConnection,
): GatewayConnectionToolConfig & {type: "gateway_connection"} {
    return {
        // The discriminator the SDK parses on. Fern models the union arm without it.
        type: "gateway_connection",
        connection: {
            provider: view.provider as GatewayConnectionToolConfig["connection"]["provider"],
            integration: view.integration,
            slug: view.connection,
        },
        policy: {
            permissions: {
                default: view.permissions.default,
                tools: {...view.permissions.tools},
            },
        },
    }
}

/** Identity of a connection entry: provider and integration, never the slug — choosing another
 *  connection edits the same entry instead of adding a second one. */
function gatewayConnectionIdentity(target: GatewayConnectionTarget): string {
    return [target.provider, target.integration].join(GATEWAY_IDENTITY_SEP)
}

/**
 * The project connection an entry points at. A slug is unique only WITHIN a provider and
 * integration, so all three have to match — on the slug alone, a surface showed another
 * integration's connection state as this one's.
 */
export function findTargetConnection(
    connections: ToolConnection[],
    target: GatewayConnectionTarget,
    connectionSlug: string,
): ToolConnection | undefined {
    if (!connectionSlug) return undefined
    return connections.find(
        (connection) =>
            connection.slug === connectionSlug &&
            connection.provider_key === target.provider &&
            connection.integration_key === target.integration,
    )
}

/**
 * Either kind of gateway entry, discriminated. The two saved shapes are disjoint, but reading them
 * as an ordered pair of parsers puts that invariant in every caller: get the order wrong and an
 * entry renders as the other kind. Every consumer that handles both goes through this instead.
 */
export type GatewayEntry =
    | {kind: "connection"; connection: ParsedGatewayConnection}
    | {kind: "action"; action: ParsedGatewayTool}

export function parseGatewayEntry(tool: unknown): GatewayEntry | null {
    const connection = parseGatewayConnection(tool)
    if (connection) return {kind: "connection", connection}
    const action = parseGatewayTool(tool)
    return action ? {kind: "action", action} : null
}

/** Index of the connection entry for `target` in a flat `tools` array, or -1. */
export function findGatewayConnectionIndex(
    tools: unknown[],
    target: GatewayConnectionTarget,
): number {
    return tools.findIndex((tool) => {
        const view = parseGatewayConnection(tool)
        return Boolean(
            view && view.provider === target.provider && view.integration === target.integration,
        )
    })
}

/**
 * Apply `view` onto the entry as it was SAVED, rather than rebuilding it from the parsed view.
 * The parser models only the fields this surface edits, so a rebuild would drop anything else the
 * entry carries. Only `connection` and `policy.permissions` are replaced; `policy.permissions` is
 * replaced whole, because clearing the per-tool map is what picking a preset means.
 */
function applyToSavedEntry(
    saved: Record<string, unknown>,
    view: ParsedGatewayConnection,
): Record<string, unknown> {
    const policy = asRecord(saved.policy) ?? {}
    return {
        ...saved,
        type: "gateway_connection",
        connection: {
            ...(asRecord(saved.connection) ?? {}),
            provider: view.provider,
            integration: view.integration,
            slug: view.connection,
        },
        policy: {
            ...policy,
            permissions: {
                default: view.permissions.default,
                tools: {...view.permissions.tools},
            },
        },
    }
}

/**
 * Write `view` into `tools`, REPLACING the entry for the same provider and integration. The saved
 * format allows one entry per provider and integration, so an append produces a revision the SDK
 * refuses to parse, and the author would see the failure only later, at run time.
 */
export function upsertGatewayConnection(
    tools: unknown[],
    view: ParsedGatewayConnection,
): unknown[] {
    const index = findGatewayConnectionIndex(tools, view)
    if (index < 0) return [...tools, buildGatewayConnectionEntry(view)]
    const next = tools.slice()
    next[index] = applyToSavedEntry(asRecord(tools[index]) ?? {}, view)
    return next
}

/**
 * One row in the tools section: an integration the agent can reach, gathered across BOTH saved
 * formats. A migrated integration contributes its connection entry; an integration still on the
 * legacy format contributes its per-action entries, which is what puts the legacy badge on the row.
 * A half-migrated integration contributes both — a supported steady state, not only a transient one.
 */
export interface IntegrationRow {
    provider: string
    integration: string
    /** The connection entry, when the integration has one. The first, if a saved revision
     *  somehow holds two — which the SDK refuses, so it is a state to surface, not to serve. */
    entry: ParsedGatewayConnection | null
    /** Positions of the connection entries in the flat `tools` array. More than one is invalid. */
    entryIndices: number[]
    /** Positions of the legacy per-action entries still present. */
    legacyIndices: number[]
    /** Distinct connection slugs across those legacy entries, in first-seen order. */
    legacyConnections: string[]
}

/** Every position an integration occupies in the flat array — what removing it must clear. */
export function integrationRowIndices(row: IntegrationRow): number[] {
    return [...row.entryIndices, ...row.legacyIndices]
}

/**
 * Drop every entry an integration owns: its connection entry and any legacy per-action ones. A
 * revision should hold one connection entry, but if one ever holds two, removing the integration
 * must clear both — otherwise the row returns with a policy the author believes they deleted.
 */
export function removeIntegrationRow(tools: unknown[], row: IntegrationRow): unknown[] {
    const dropped = new Set(integrationRowIndices(row))
    return tools.filter((_, index) => !dropped.has(index))
}

/** Group a flat `tools` array into one row per integration, in first-seen order. */
export function buildIntegrationRows(tools: unknown[]): IntegrationRow[] {
    const rows = new Map<string, IntegrationRow>()
    const rowFor = (provider: string, integration: string): IntegrationRow => {
        const key = gatewayConnectionIdentity({provider, integration})
        let row = rows.get(key)
        if (!row) {
            row = {
                provider,
                integration,
                entry: null,
                entryIndices: [],
                legacyIndices: [],
                legacyConnections: [],
            }
            rows.set(key, row)
        }
        return row
    }
    tools.forEach((tool, index) => {
        const entry = parseGatewayEntry(tool)
        if (!entry) return
        if (entry.kind === "connection") {
            const row = rowFor(entry.connection.provider, entry.connection.integration)
            // One entry per provider and integration is the rule. Show the first if a saved
            // revision ever breaks it, instead of letting the last one win silently, and keep
            // every position so removing the integration clears all of them.
            row.entryIndices.push(index)
            if (!row.entry) row.entry = entry.connection
            return
        }
        const row = rowFor(entry.action.provider, entry.action.integration)
        row.legacyIndices.push(index)
        if (!row.legacyConnections.includes(entry.action.connection))
            row.legacyConnections.push(entry.action.connection)
    })
    return [...rows.values()]
}

/** The row for one integration. Keyed on provider AND integration, which is what identifies an
 *  entry — matching on the integration alone would confuse two providers' rows. */
export function findIntegrationRow(
    rows: IntegrationRow[],
    target: GatewayConnectionTarget,
): IntegrationRow | undefined {
    return rows.find(
        (row) => row.provider === target.provider && row.integration === target.integration,
    )
}

/** The connection slug a row runs under: the entry's, else the one its legacy entries agree on. */
export function integrationRowConnection(row: IntegrationRow): string | undefined {
    if (row.entry) return row.entry.connection
    return row.legacyConnections.length === 1 ? row.legacyConnections[0] : undefined
}

/** Replace the permission object of the entry for `target`. Returns `tools` when there is none. */
export function setGatewayConnectionPermissions(
    tools: unknown[],
    target: GatewayConnectionTarget,
    permissions: GatewayConnectionPermissions,
): unknown[] {
    const index = findGatewayConnectionIndex(tools, target)
    if (index < 0) return tools
    const view = parseGatewayConnection(tools[index])
    if (!view) return tools
    const next = tools.slice()
    // Apply, never rebuild: the parser models only the fields this surface edits.
    next[index] = applyToSavedEntry(asRecord(tools[index]) ?? {}, {...view, permissions})
    return next
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
