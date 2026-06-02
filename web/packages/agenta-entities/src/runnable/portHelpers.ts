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
 * segment, then splits snake_case and camelCase into spaces.
 *
 * Does NOT auto-capitalize the first letter — user-authored keys preserve
 * their original casing. `outputs` stays `outputs`; the only mechanical
 * transformations applied are path stripping and word splitting.
 */
export function formatKeyAsName(key: string): string {
    const label = extractLastPathSegment(key)
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
    return label.charAt(0).toUpperCase() + label.slice(1)
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
     * Declared shape.
     *   - `"array"` when the name appears as a mustache section opener
     *     (`{{#languages}}…{{/languages}}`). The iteration intent is the
     *     strongest signal mustache gives us — even when sub-paths are
     *     also referenced, an array of objects fits better than a single
     *     object. Mustache resolves both at runtime (an array iterates,
     *     a non-array truthy value renders the block once), so prefer
     *     the more common case in the UI default.
     *   - `"object"` when sub-paths are referenced but the name is NOT
     *     a section opener (`{{geo.region}}` → object with `region`
     *     sub-path).
     *   - `"string"` otherwise.
     */
    type: "string" | "object" | "array"
    /**
     * Known sub-paths beneath the group.
     *
     *   - For `type === "object"`: keys on the object value.
     *   - For `type === "array"`: keys on each ROW of the array (the
     *     items shape). Used downstream by the schema producer to emit
     *     `{type: "array", items: {type: "object", properties: …}}` so
     *     the form view can render an array-of-objects editor.
     *
     * Used to seed a shape-hint default in the JSON / Form editors so
     * users see which keys the template references without having to
     * re-read the prompt. Example: `["country", "capital"]` for
     * `$.inputs.test.{country, capital}`.
     */
    subPaths?: string[]
    /**
     * Sub-paths within this group that are themselves mustache section
     * openers — surfaces nested array-of-objects shapes to the schema
     * producer. For `{{#repos}}{{#contributors}}{{name}}{{/contributors}}
     * {{/repos}}`, the `repos` group emits `subPaths: ["contributors",
     * "contributors.name"]` AND `sectionSubPaths: ["contributors"]`, so
     * `buildSubPathSchema` knows to emit `contributors` as `{type:
     * "array", items: {…}}` at that depth instead of an object.
     *
     * Always a subset of `subPaths` (a path must appear somewhere in the
     * template to be a sub-path). Mustache-only; omitted for non-section
     * groups and for groups with no nested sections.
     */
    sectionSubPaths?: string[]
}

interface ParsedTemplateExpression {
    /** Envelope slot (defaults to `"inputs"` for plain names). */
    envelope: string
    /** Field name under the envelope. Empty if the path only named a slot. */
    key: string
    /** Remaining path beneath the group, if any. */
    subPath?: string
}

/** Subset of TemplateFormat needed for the literal-vs-nested decision in
 *  `parseTemplateExpression`. Curly is special-cased because its backend
 *  resolver does literal-key-first lookup; the others either follow the
 *  Mustache spec (dotted names are nested) or share the same nested
 *  semantics. Kept as a string literal union so the helper stays
 *  free-standing — no need to pull the full `TemplateFormat` type in here. */
type TemplateFormatForParse = "mustache" | "curly" | "fstring" | "jinja2"

/**
 * Parse a single template placeholder into `{envelope, key, subPath?}`.
 *
 * The envelope slot is the FIRST segment under `$`, `/`, or the raw dot
 * path. The key is the SECOND segment — the "root variable" the user is
 * referencing within that slot. Anything deeper is a sub-path that will
 * be grouped into an object-typed variable.
 *
 * Examples (mustache/jinja2 — i.e. nested dot-notation):
 *   `$.inputs.country`          → {envelope: "inputs",    key: "country"}
 *   `$.inputs.arda.test254`     → {envelope: "inputs",    key: "arda",    subPath: "test254"}
 *   `$.inputs.arda.a.b`         → {envelope: "inputs",    key: "arda",    subPath: "a.b"}
 *   `/outputs/score`            → {envelope: "outputs",   key: "score"}
 *   `country`                   → {envelope: "inputs",    key: "country"}   (default slot)
 *   `inputs.country`            → {envelope: "inputs",    key: "country"}
 *   `user.name`                 → {envelope: "inputs",    key: "user",    subPath: "name"}
 *
 * Curly is special — `templateFormat === "curly"` forces plain dotted
 * names (no `$`/`/` prefix, no envelope first segment) to be treated as
 * LITERAL single keys instead of nested paths. Background: the backend
 * curly renderer does literal-key-first lookup (see
 * `sdks/python/agenta/sdk/utils/resolvers.py:46-50`), so `{{user.name}}`
 * in a curly prompt should map to a testcase column LITERALLY named
 * `"user.name"`. Legacy curly testsets commonly carry such dotted column
 * names; treating them as nested would orphan the value in the
 * "unused columns" footer and force the user to re-author the data.
 *
 * Curly examples:
 *   `user.name`                 → {envelope: "inputs",    key: "user.name"}  (literal)
 *   `topic.story`               → {envelope: "inputs",    key: "topic.story"}
 *   `inputs.country`            → {envelope: "inputs",    key: "country"}    (envelope still routes)
 *   `$.inputs.country`          → {envelope: "inputs",    key: "country"}    (JSONPath unchanged)
 *
 * JSONPath and JSON Pointer paths are always parsed as nested regardless
 * of format — the backend treats `$.*` / `/*` identically across curly,
 * mustache, and jinja2 (see `templating.py:14-16`).
 *
 * Validation is performed upstream in `groupTemplateVariables` via
 * `isValidTemplateVariable`, so this parser can assume the envelope
 * segment is a known slot.
 */
function parseTemplateExpression(
    expr: string,
    templateFormat?: TemplateFormatForParse,
): ParsedTemplateExpression {
    if (!expr) return {envelope: "inputs", key: ""}

    const parseSegments = (segments: string[]): ParsedTemplateExpression => {
        if (segments.length === 0) return {envelope: "inputs", key: ""}

        const first = segments[0]
        const firstIsEnvelope = KNOWN_ENVELOPE_SLOTS.has(first)

        if (segments.length === 1) {
            // `$.inputs` / `$.outputs` — envelope-only reference.
            if (firstIsEnvelope) return {envelope: first, key: ""}
            // `$.profile` — testcase-spread key. Per the RFC, testcase
            // top-level columns are spread into the render context, so
            // they live implicitly under the `inputs` envelope. Treating
            // the first segment as the key under `inputs` keeps port
            // discovery consistent with envelope-rooted writes.
            return {envelope: "inputs", key: first}
        }

        if (firstIsEnvelope) {
            return {
                envelope: first,
                key: segments[1],
                subPath: segments.length > 2 ? segments.slice(2).join(".") : undefined,
            }
        }
        // Testcase-spread key with a sub-path: `$.profile.name` →
        // `{envelope: "inputs", key: "profile", subPath: "name"}`. The
        // testcase spread makes this equivalent to `$.inputs.profile.name`.
        return {
            envelope: "inputs",
            key: first,
            subPath: segments.length > 1 ? segments.slice(1).join(".") : undefined,
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
    //
    // EXCEPTION — curly: backend curly does literal-key-first lookup, so
    // a curly user authoring `{{user.name}}` typically means a column
    // literally named `"user.name"`. Returning a literal key here aligns
    // FE port discovery with the backend resolver and preserves legacy
    // curly testsets with dotted column names. See the docstring above.
    if (expr.includes(".")) {
        const tokens = expr.split(".").filter(Boolean)
        if (tokens.length === 0) return {envelope: "inputs", key: ""}
        if (tokens.length === 1) return {envelope: "inputs", key: tokens[0]}
        if (KNOWN_ENVELOPE_SLOTS.has(tokens[0])) return parseSegments(tokens)
        if (templateFormat === "curly") {
            return {envelope: "inputs", key: expr}
        }
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
export function groupTemplateVariables(
    placeholders: string[],
    options?: {
        /** Set of names that appeared as mustache section openers
         *  (`{{#name}}` / `{{^name}}`) in the source template. Used to
         *  refine type inference: a name referenced ONLY as a section
         *  opener (no sub-paths) gets `type: "array"` — the iteration
         *  intent is the strongest signal we have without parsing the
         *  block body. Names with sub-paths stay `"object"` regardless. */
        sectionOpeners?: Set<string>
        /** Active template format for the source workflow. Only `"curly"`
         *  changes parsing behaviour — it forces plain dotted names (no
         *  `$`/`/` prefix, no envelope first segment) to be kept as
         *  LITERAL single keys, matching the backend curly resolver's
         *  literal-key-first lookup. Omit / pass anything else to keep
         *  the nested dot-notation behaviour (Mustache spec / Jinja2
         *  attribute access). See `parseTemplateExpression` docstring. */
        templateFormat?: TemplateFormatForParse
    },
): GroupedTemplateVariable[] {
    const groups = new Map<string, {envelope: string; key: string; subPaths: Set<string>}>()
    const templateFormat = options?.templateFormat

    // Resolve section opener names through `parseTemplateExpression` and
    // key them by envelope-scoped `${envelope}.${key}` ids — same identity
    // the `groups` map uses below. Otherwise a section opener written as
    // `{{#languages}}` would coerce BOTH `inputs.languages` AND
    // `outputs.languages` (if both existed in the same prompt) to `array`.
    //
    // Section openers are mustache-only by construction (curly / jinja2 /
    // fstring have no `{{#name}}` syntax) so we don't need to thread the
    // format flag through this resolution — but doing it consistently
    // keeps the helper format-aware end-to-end.
    const sectionOpenerIds = new Set<string>()
    // Nested-section paths recorded per group. For `{{#repos}}{{#contributors}}
    // …{{/contributors}}{{/repos}}`, `extractMustacheSectionOpeners` emits
    // both `repos` and `repos.contributors`. The former contributes to
    // `sectionOpenerIds` (the group `inputs.repos` is itself a section);
    // the latter contributes `contributors` to
    // `nestedSectionsByGroup["inputs.repos"]` so the schema producer can
    // emit an array-of-objects shape at that sub-path's depth.
    const nestedSectionsByGroup = new Map<string, Set<string>>()
    if (options?.sectionOpeners) {
        for (const opener of options.sectionOpeners) {
            const parsed = parseTemplateExpression(opener, templateFormat)
            if (!parsed.key) continue
            const groupId = `${parsed.envelope}.${parsed.key}`
            if (parsed.subPath) {
                // Nested section under an existing group root.
                let set = nestedSectionsByGroup.get(groupId)
                if (!set) {
                    set = new Set()
                    nestedSectionsByGroup.set(groupId, set)
                }
                set.add(parsed.subPath)
            } else {
                // Group root itself is a section opener.
                sectionOpenerIds.add(groupId)
            }
        }
    }

    for (const placeholder of placeholders) {
        // Structurally malformed placeholders (e.g. empty, `$outputs.x` with
        // no dot after `$`, `$.` with no field, `$..foo` empty segment) don't
        // get an input control. The prompt editor's token node renders them
        // with a distinct invalid state so the user sees the problem at the
        // source. Near-typos of envelope slots (`$.input.x`) are NOT filtered
        // here — they're treated as testcase-spread keys per the post-2026-
        // 05-28 mustache QA principle (see `templateVariable.ts` docstring).
        if (!isValidTemplateVariable(placeholder)) continue

        const parsed = parseTemplateExpression(placeholder, templateFormat)
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
        // Type inference priority:
        //   1. Section opener → `"array"` (iteration intent — the
        //      strongest signal mustache gives us). Sub-paths describe the
        //      ROW shape; the schema producer emits `{type: "array", items:
        //      {type: "object", properties: …}}` so the array-of-objects
        //      case (the common one for templates that loop over a list)
        //      renders cleanly in the form view. Single-object templates
        //      still render once at runtime — mustache treats a non-array
        //      truthy value as a one-element iteration.
        //   2. Sub-paths present (no section opener) → `"object"`.
        //   3. Otherwise → `"string"`.
        const groupId = `${envelope}.${key}`
        const isSectionOpener = sectionOpenerIds.has(groupId)
        const type: GroupedTemplateVariable["type"] = isSectionOpener
            ? "array"
            : subPathList.length > 0
              ? "object"
              : "string"
        const nestedSet = nestedSectionsByGroup.get(groupId)
        const sectionSubPathList = nestedSet ? Array.from(nestedSet) : []
        return {
            envelope,
            key,
            name: key,
            type,
            ...(subPathList.length > 0 ? {subPaths: subPathList} : {}),
            ...(sectionSubPathList.length > 0 ? {sectionSubPaths: sectionSubPathList} : {}),
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
                name: "output",
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
                name: "output",
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
