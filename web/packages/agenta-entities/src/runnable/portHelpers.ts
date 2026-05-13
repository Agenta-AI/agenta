/**
 * Port Extraction Helpers
 *
 * Pure functions for deriving input/output ports from JSON schemas.
 * Used by workflow molecule selectors and integration helpers.
 *
 * @packageDocumentation
 */

import {isValidTemplateVariable, KNOWN_ENVELOPE_SLOTS} from "@agenta/shared/utils"

import type {RunnablePort} from "../shared"

// ============================================================================
// JSON SCHEMA $ref RESOLUTION
// ============================================================================

/**
 * Resolve a JSON Schema node that may contain a `$ref` pointer.
 *
 * Supports local `$defs`-style references (e.g., `{"$ref": "#/$defs/result"}`).
 * When the node is not a `$ref` or the target is missing, returns the node as-is.
 *
 * @param node  - A JSON Schema node (may be a `$ref` object)
 * @param defs  - The `$defs` map from the root schema
 */
export function resolveSchemaRef(
    node: unknown,
    defs?: Record<string, unknown>,
): Record<string, unknown> {
    if (!node || typeof node !== "object") return {}
    const obj = node as Record<string, unknown>

    if (typeof obj.$ref === "string" && defs) {
        // Support "#/$defs/<key>" and "#/definitions/<key>" pointers
        const ref = obj.$ref as string
        const match = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
        if (match) {
            const resolved = defs[match[1]]
            if (resolved && typeof resolved === "object") {
                return resolved as Record<string, unknown>
            }
        }
    }

    return obj
}

/**
 * Derive the effective type string from a schema node, resolving `$ref` if needed.
 */
export function resolveSchemaType(node: unknown, defs?: Record<string, unknown>): string {
    const resolved = resolveSchemaRef(node, defs)
    if (typeof resolved.type === "string") return resolved.type
    return "string"
}

// ============================================================================
// FORMATTING
// ============================================================================

/**
 * Extract the last semantic segment from a path-style key.
 *
 * Template variables can be written as paths that the backend resolver
 * interprets at runtime (see `sdk/agenta/sdk/utils/resolvers.py`):
 *   - JSONPath:  `$.inputs.country` → `country`
 *   - JSON Pointer: `/inputs/country` → `country`
 *   - Dot notation: `inputs.country` → `country`
 *
 * Displaying the raw path as a variable label is unreadable; the key itself
 * must stay unchanged (it identifies the variable and is what's forwarded
 * to the backend), so only the DISPLAY label is derived from the last
 * segment.
 *
 * Unlike `formatKeyAsName`, this is identifier-preserving — it does NOT
 * apply Title Case. Use it for code-style variable labels; use
 * `formatKeyAsName` for field labels (evaluator metrics, testset columns)
 * where Title Case reads as intended.
 */
export function extractLastPathSegment(key: string): string {
    if (!key) return key

    // JSONPath — strip leading `$`, split on `.` and bracket accessors
    if (key.startsWith("$")) {
        const parts = key
            .replace(/^\$\.?/, "")
            .split(/[.[\]'"]/)
            .filter(Boolean)
        return parts[parts.length - 1] || key
    }

    // JSON Pointer
    if (key.startsWith("/")) {
        const parts = key.split("/").filter(Boolean)
        return parts[parts.length - 1] || key
    }

    // Dot notation — only treat as a path when it contains a dot;
    // plain names (no dots) pass through unchanged.
    if (key.includes(".")) {
        const parts = key.split(".").filter(Boolean)
        return parts[parts.length - 1] || key
    }

    return key
}

/**
 * Format a key as a human-readable name.
 * Strips path syntax (JSONPath / JSON Pointer / dot notation) to the last
 * segment, then converts snake_case and camelCase to Title Case.
 */
export function formatKeyAsName(key: string): string {
    return extractLastPathSegment(key)
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (str) => str.toUpperCase())
}

// ============================================================================
// TEMPLATE VARIABLE GROUPING
// ============================================================================

export interface GroupedTemplateVariable {
    /**
     * Envelope slot the variable addresses in the invocation request
     * (`inputs`, `outputs`, `parameters`, `testcase`, `trace`, `revision`).
     * Plain variables without a path prefix default to `"inputs"`.
     */
    envelope: string
    /**
     * Field name UNDER the envelope slot. Clean — no path prefix. This
     * is the testcase column key / port key when `envelope === "inputs"`.
     * For `$.inputs.arda.test254` → `"arda"`.
     */
    key: string
    /** Display label. Same as `key` under this model. */
    name: string
    /**
     * Declared shape. `"object"` when any placeholder references a sub-path
     * of this group (signals the UI to render a JSON editor); otherwise
     * `"string"`.
     */
    type: "string" | "object"
    /**
     * Known sub-paths beneath the group (populated only when `type === "object"`).
     * Used to seed a shape-hint default in the JSON editor so users see
     * which keys the template references without having to re-read the prompt.
     * Example: `["country", "capital"]` for `$.inputs.test.{country, capital}`.
     */
    subPaths?: string[]
}

interface ParsedTemplateExpression {
    /** Envelope slot (defaults to `"inputs"` for plain names). */
    envelope: string
    /** Field name under the envelope. Empty if the path only named a slot. */
    key: string
    /** Remaining path beneath the group, if any. */
    subPath?: string
}

/**
 * Parse a single template placeholder into `{envelope, key, subPath?}`.
 *
 * The envelope slot is the FIRST segment under `$`, `/`, or the raw dot
 * path. The key is the SECOND segment — the "root variable" the user is
 * referencing within that slot. Anything deeper is a sub-path that will
 * be grouped into an object-typed variable.
 *
 * Examples:
 *   `$.inputs.country`          → {envelope: "inputs",    key: "country"}
 *   `$.inputs.arda.test254`     → {envelope: "inputs",    key: "arda",    subPath: "test254"}
 *   `$.inputs.arda.a.b`         → {envelope: "inputs",    key: "arda",    subPath: "a.b"}
 *   `/outputs/score`            → {envelope: "outputs",   key: "score"}
 *   `country`                   → {envelope: "inputs",    key: "country"}   (default slot)
 *   `inputs.country`            → {envelope: "inputs",    key: "country"}
 *   `user.name`                 → {envelope: "inputs",    key: "user",    subPath: "name"}
 *
 * Validation is performed upstream in `groupTemplateVariables` via
 * `isValidTemplateVariable`, so this parser can assume the envelope
 * segment is a known slot.
 */
function parseTemplateExpression(expr: string): ParsedTemplateExpression {
    if (!expr) return {envelope: "inputs", key: ""}

    const parseSegments = (segments: string[]): ParsedTemplateExpression => {
        if (segments.length === 0) return {envelope: "inputs", key: ""}
        if (segments.length === 1) return {envelope: segments[0], key: ""}
        return {
            envelope: segments[0],
            key: segments[1],
            subPath: segments.length > 2 ? segments.slice(2).join(".") : undefined,
        }
    }

    // JSONPath
    if (expr.startsWith("$")) {
        const tokens = expr
            .replace(/^\$\.?/, "")
            .split(/[.[\]'"]/)
            .filter(Boolean)
        return parseSegments(tokens)
    }

    // JSON Pointer
    if (expr.startsWith("/")) {
        const tokens = expr.split("/").filter(Boolean)
        if (tokens.length <= 1) return parseSegments(tokens)
        return {
            envelope: tokens[0],
            key: tokens[1],
            subPath: tokens.length > 2 ? tokens.slice(2).join("/") : undefined,
        }
    }

    // Dot notation (no $/) — envelope-scoped only when the first segment
    // names a known slot (e.g. `inputs.country`). Plain dotted names like
    // `user.name` would otherwise be misclassified as `{envelope: "user",
    // key: "name"}` and get dropped by consumers that materialize only
    // `envelope === "inputs"`. Treat them as inputs-scoped sub-path
    // references (`{envelope: "inputs", key: "user", subPath: "name"}`),
    // matching how `$.inputs.user.name` parses.
    if (expr.includes(".")) {
        const tokens = expr.split(".").filter(Boolean)
        if (tokens.length === 0) return {envelope: "inputs", key: ""}
        if (tokens.length === 1) return {envelope: "inputs", key: tokens[0]}
        if (KNOWN_ENVELOPE_SLOTS.has(tokens[0])) return parseSegments(tokens)
        return {
            envelope: "inputs",
            key: tokens[0],
            subPath: tokens.slice(1).join("."),
        }
    }

    // Plain name — inputs slot, single field.
    return {envelope: "inputs", key: expr}
}

/**
 * Group template placeholders by `{envelope, key}`, collapsing deeper
 * sub-path references into a single object-typed variable.
 *
 * Input:
 *   ["$.inputs.test.country", "$.inputs.test.capital",
 *    "$.inputs.name", "country", "$.outputs.score"]
 * Output:
 *   [
 *     {envelope: "inputs",  key: "test",    type: "object", subPaths: ["country", "capital"]},
 *     {envelope: "inputs",  key: "name",    type: "string"},
 *     {envelope: "inputs",  key: "country", type: "string"},
 *     {envelope: "outputs", key: "score",   type: "string"},
 *   ]
 *
 * Consumers filter by envelope — testcase columns only materialize for
 * `envelope === "inputs"`; other slots are runtime-resolved (backend
 * populates them from trace / workflow config / etc.).
 */
export function groupTemplateVariables(placeholders: string[]): GroupedTemplateVariable[] {
    const groups = new Map<string, {envelope: string; key: string; subPaths: Set<string>}>()

    for (const placeholder of placeholders) {
        // Invalid envelope references (e.g. `$.input.xx.abc` — `input` is not
        // a known envelope slot) don't get an input control. The prompt
        // editor's token node renders them with a distinct invalid state so
        // the user sees the problem at the source.
        if (!isValidTemplateVariable(placeholder)) continue

        const parsed = parseTemplateExpression(placeholder)
        if (!parsed.key) continue // envelope-only reference, not a specific field

        const groupId = `${parsed.envelope}.${parsed.key}`
        const existing = groups.get(groupId)
        if (existing) {
            if (parsed.subPath) existing.subPaths.add(parsed.subPath)
        } else {
            groups.set(groupId, {
                envelope: parsed.envelope,
                key: parsed.key,
                subPaths: new Set(parsed.subPath ? [parsed.subPath] : []),
            })
        }
    }

    return Array.from(groups.values()).map(({envelope, key, subPaths}) => {
        const subPathList = Array.from(subPaths)
        return {
            envelope,
            key,
            name: key,
            type: subPathList.length > 0 ? ("object" as const) : ("string" as const),
            ...(subPathList.length > 0 ? {subPaths: subPathList} : {}),
        }
    })
}

/**
 * Check whether a schema property is a system-level field annotated with
 * `x-ag-*` markers (e.g. `x-ag-context`, `x-ag-consent`, `x-ag-variables`,
 * `x-ag-content`, or `x-ag-type` for messages/message).  These are transport
 * fields managed by the runtime and should not appear as user-facing inputs.
 */
function isSystemField(prop: unknown): boolean {
    if (!prop || typeof prop !== "object") return false
    const obj = prop as Record<string, unknown>
    return Object.keys(obj).some((k) => k.startsWith("x-ag-"))
}

/**
 * Extract the set of system-level field names from an inputs schema.
 * Returns field names annotated with `x-ag-*` markers so callers can
 * filter template variables that collide with runtime-managed fields.
 */
export function extractSystemFieldNames(schema: unknown): Set<string> {
    if (!schema || typeof schema !== "object") return new Set()
    const s = schema as Record<string, unknown>
    const properties = s.properties as Record<string, unknown> | undefined
    if (!properties) return new Set()

    const names = new Set<string>()
    for (const [key, prop] of Object.entries(properties)) {
        if (isSystemField(prop)) names.add(key)
    }
    return names
}

/**
 * Extract input ports from a JSON schema.
 * Maps each top-level property to a RunnablePort, filtering out system-level
 * fields annotated with `x-ag-*` markers.
 */
export function extractInputPortsFromSchema(schema: unknown): RunnablePort[] {
    if (!schema || typeof schema !== "object") return []

    const s = schema as Record<string, unknown>
    const properties = s.properties as Record<string, unknown> | undefined
    const required = (s.required as string[]) || []
    const defs = (s.$defs ?? s.definitions) as Record<string, unknown> | undefined

    if (!properties) return []

    return Object.entries(properties)
        .filter(([, prop]) => !isSystemField(prop))
        .map(([key, prop]) => {
            const resolved = resolveSchemaRef(prop, defs)
            return {
                key,
                name: (resolved.title as string) || formatKeyAsName(key),
                type: resolveSchemaType(prop, defs),
                required: required.includes(key),
                schema: prop,
            }
        })
}

/**
 * Extract output ports from a JSON schema.
 * Handles both simple type schemas and object schemas with properties.
 * Resolves `$ref` pointers against the schema's `$defs` for proper type inference.
 */
export function extractOutputPortsFromSchema(schema: unknown): RunnablePort[] {
    if (!schema || typeof schema !== "object") return []

    const s = schema as Record<string, unknown>
    const defs = (s.$defs ?? s.definitions) as Record<string, unknown> | undefined

    // Handle simple type schema
    if (s.type && s.type !== "object") {
        return [
            {
                key: "output",
                name: "Output",
                type: s.type as string,
                schema,
            },
        ]
    }

    // Handle object schema
    const properties = s.properties as Record<string, unknown> | undefined
    if (!properties) {
        return [
            {
                key: "output",
                name: "Output",
                type: "unknown",
                schema,
            },
        ]
    }

    return Object.entries(properties).map(([key, prop]) => {
        const resolved = resolveSchemaRef(prop, defs)
        return {
            key,
            name: (resolved.title as string) || formatKeyAsName(key),
            type: resolveSchemaType(prop, defs),
            schema: prop,
        }
    })
}
