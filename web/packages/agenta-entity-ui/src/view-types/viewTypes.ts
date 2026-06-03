/**
 * Shared view-type vocabulary + per-value option logic for the playground
 * input UX (and any other surface that needs a "view as ..." dropdown over
 * a typed value).
 *
 * Promoted from the design-mockups POC (`ProposalV2Views.ts`). See:
 *   - `docs/design/prompt-runtime-unification/README.md` (WP-F1)
 *   - Approved design doc in `~/.gstack/projects/Agenta-AI-agenta/...`
 *
 * The 6 available view types:
 *   - text     | unquoted plain text (string only)
 *   - markdown | rendered markdown (string only)
 *   - chat     | chat-bubble rendering (messages-shaped arrays only)
 *   - form     | labelled-form rendering (objects)
 *   - json     | structured JSON in a code editor (always available)
 *   - yaml     | structured YAML in a code editor (always available)
 *
 * `FieldKind` is the 4-way TOP-LEVEL bucketing used to compute the view-mode
 * dropdown options for a given value. It is intentionally coarse:
 *   - string  : strings + numbers + nulls (single-primitive values)
 *   - boolean : true / false
 *   - object  : any structured value (object, non-message array)
 *   - chat    : array of role-tagged message objects
 *
 * ⚠️ `FieldKind` is NOT the type-chip vocabulary. For the chip, use
 * `inferLogicalType` from `@agenta/shared/utils` + `TypeChip` from
 * `@agenta/ui`. The chip vocabulary is granular (string/number/boolean/null/
 * json-object/json-array) plus render-hint and state chips. Two distinct
 * concerns, two distinct vocabularies.
 */

/** A user-selectable rendering mode for a value. */
export type ViewType = "text" | "markdown" | "chat" | "form" | "json" | "yaml"

/**
 * 4-way bucketing used to compute the view-mode dropdown options for a
 * top-level value. Internal to the view-options decision.
 *
 * @see FieldKind doc comment in this file for why this is NOT the chip vocab.
 */
export type FieldKind = "string" | "boolean" | "object" | "chat"

/**
 * Whether the given top-level value should be treated as `chat` (an array of
 * role-tagged message objects). Tool-calls and tool-responses still count.
 */
export function isChatMessagesArray(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return false
    const VALID_ROLES = new Set(["system", "user", "assistant", "tool", "developer", "function"])
    return value.every((item) => {
        if (!item || typeof item !== "object") return false
        const role = (item as Record<string, unknown>).role
        return typeof role === "string" && VALID_ROLES.has(role)
    })
}

/**
 * Reduce the runtime type to the 4-way top-level vocabulary used to decide
 * available view modes:
 *   - chat    : array of role-tagged messages
 *   - object  : any structured value (object, plain array)
 *   - boolean : true / false
 *   - string  : everything else (string, number, null, undefined)
 *
 * Numbers and nulls are bucketed into `string` because they only appear at
 * the top level as single primitives — no separate dropdown options needed.
 */
export function detectFieldKind(value: unknown): FieldKind {
    if (isChatMessagesArray(value)) return "chat"
    if (typeof value === "boolean") return "boolean"
    if (Array.isArray(value)) return "object"
    if (value !== null && typeof value === "object") return "object"
    return "string"
}

/**
 * Inside a form / nested context we want the precise runtime type so the
 * right widget renders (Switch for boolean, InputNumber for number,
 * Input.TextArea for string, etc.).
 */
export type NestedKind = "string" | "number" | "boolean" | "null" | "object" | "array"

export function detectNestedKind(value: unknown): NestedKind {
    if (value === null) return "null"
    if (typeof value === "string") return "string"
    if (typeof value === "number") return "number"
    if (typeof value === "boolean") return "boolean"
    if (Array.isArray(value)) return "array"
    if (typeof value === "object") return "object"
    return "string"
}

/** A dropdown option for the "View as ▾" select. */
export interface ViewOption {
    value: ViewType
    label: string
    /** Tiny right-aligned hint inside the dropdown row (e.g. "default", "raw"). */
    hint?: string
}

/**
 * Compute the dropdown options for a top-level field. Always includes JSON +
 * YAML. Adds Text/Markdown for strings, Chat for chat arrays, Form for objects.
 */
export function getViewOptions(value: unknown): ViewOption[] {
    const kind = detectFieldKind(value)
    const opts: ViewOption[] = []

    if (kind === "string") {
        opts.push({value: "text", label: "Text", hint: "default"})
        opts.push({value: "markdown", label: "Markdown"})
    } else if (kind === "boolean") {
        opts.push({value: "text", label: "Text", hint: "default"})
    } else if (kind === "chat") {
        opts.push({value: "chat", label: "Chat", hint: "default"})
    } else if (kind === "object") {
        opts.push({value: "form", label: "Form", hint: "default"})
    }

    opts.push({value: "json", label: "JSON"})
    opts.push({value: "yaml", label: "YAML"})

    return opts
}

/** Default view for a top-level field. */
export function getDefaultViewForValue(value: unknown): ViewType {
    return getViewOptions(value)[0]?.value ?? "json"
}

// ─── Expected-type-aware variants ──────────────────────────────────────────
//
// The plain `getViewOptions` / `getDefaultViewForValue` look only at the
// runtime VALUE. For draft variables (referenced by prompt, not authored on
// the testcase yet) the value is `undefined` — they fall through to the
// "string" branch and produce text-input defaults even when the port schema
// declares the variable as object/array (e.g. `geo` referenced via
// `{{geo.region}}` / `{{geo.coordinates.lat}}`).
//
// The expected-type-aware variants below use the port schema's declared type
// as a fallback when the runtime value is empty (`undefined` / `null` / `""`),
// so draft object ports open as Form by default and chat-shaped arrays open
// as Chat, matching what the user has clearly authored against.
//
// `ExpectedType` is intentionally narrow — it mirrors the port `type` field
// surfaced by `inputPortSchemaMap` (`string` / `number` / `integer` /
// `boolean` / `object` / `array`). Unknown types fall back to value-driven
// behaviour.

/** Declared port type from the runnable schema. */
export type ExpectedType =
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "object"
    | "array"
    | undefined

function isValueEmpty(value: unknown): boolean {
    return value === undefined || value === null || value === ""
}

function fieldKindFromExpected(expected: ExpectedType): FieldKind | null {
    if (expected === "object" || expected === "array") return "object"
    if (expected === "boolean") return "boolean"
    if (expected === "string" || expected === "number" || expected === "integer") return "string"
    return null
}

/**
 * Same shape as `getViewOptions(value)`, but when `value` is empty, the
 * dropdown is built from `expectedType` instead. This is how a draft
 * variable known to be an object opens as `Form` rather than `Text`.
 *
 * Ordering convention (consistent across every expectedType): the
 * kind-specific modes go first, JSON and YAML always live at the BOTTOM.
 * Strings get `[String, Markdown, JSON, YAML]`, objects/arrays get
 * `[Form, JSON, YAML]`, booleans get `[String, JSON, YAML]`. The default
 * mode is decoupled from list order — see `getDefaultViewForExpectedType`
 * — so array drafts can still default to JSON without yanking JSON out
 * of its conventional bottom-of-the-list slot.
 */
export function getViewOptionsForExpectedType(
    value: unknown,
    expectedType: ExpectedType,
): ViewOption[] {
    if (!isValueEmpty(value)) return getViewOptions(value)
    const expectedKind = fieldKindFromExpected(expectedType)
    if (!expectedKind) return getViewOptions(value)

    const opts: ViewOption[] = []
    if (expectedKind === "string") {
        opts.push({value: "text", label: "Text", hint: "default"})
        opts.push({value: "markdown", label: "Markdown"})
    } else if (expectedKind === "boolean") {
        opts.push({value: "text", label: "Text", hint: "default"})
    } else if (expectedKind === "object") {
        opts.push({value: "form", label: "Form"})
    }
    // JSON / YAML always at the bottom, in this order, for every kind.
    opts.push({value: "json", label: "JSON"})
    opts.push({value: "yaml", label: "YAML"})
    return opts
}

/**
 * Default view mode for a typed draft. Independent of list order —
 * `getViewOptionsForExpectedType` keeps a consistent layout regardless
 * of which mode is the default.
 *
 *   - object → Form (seeded with empty-shape when a schema is known)
 *   - array of objects (`expectedSchema.items` describes a row shape)
 *            → Form  (the form-array editor's `+ Add row` makes the
 *                     empty-state UX clean; user clicks once to extend)
 *   - array (no items schema or items are primitives)
 *            → JSON  (FormView's array-of-primitives case lacks an
 *                     `add row` template, JSON's buffer is friendlier)
 *   - string/number/integer/boolean → text ("Text" label)
 */
export function getDefaultViewForExpectedType(
    value: unknown,
    expectedType: ExpectedType,
    expectedSchema?: unknown,
): ViewType {
    if (!isValueEmpty(value)) return getDefaultViewForValue(value)
    if (expectedType === "object") return "form"
    if (expectedType === "array") {
        // Array-of-objects (mustache section opener with sub-paths) →
        // open in Form view so the user sees a row-per-item layout with
        // a clear `+ Add row` affordance. Plain arrays (no items schema
        // or items that aren't object-shaped) stay on JSON, which is
        // friendlier for arrays of primitives.
        if (isArrayOfObjectsSchema(expectedSchema)) return "form"
        return "json"
    }
    if (expectedType === "boolean") return "text"
    if (expectedType === "string" || expectedType === "number" || expectedType === "integer") {
        return "text"
    }
    return getDefaultViewForValue(value)
}

/** Whether a schema fragment describes an array whose items have an
 *  object-with-properties shape — the array-of-objects case the form
 *  view's `+ Add row` editor handles natively. */
function isArrayOfObjectsSchema(schema: unknown): boolean {
    if (!schema || typeof schema !== "object") return false
    const s = schema as {type?: string; items?: unknown}
    if (s.type !== "array" || !s.items || typeof s.items !== "object") return false
    const items = s.items as {type?: string; properties?: unknown; _pathHints?: unknown}
    if (items.type !== "object") return false
    const hasProperties =
        !!items.properties &&
        typeof items.properties === "object" &&
        Object.keys(items.properties as object).length > 0
    const hasPathHints = Array.isArray(items._pathHints) && items._pathHints.length > 0
    return hasProperties || hasPathHints
}

// ─── Empty-shape seed from JSON schema ─────────────────────────────────────
//
// When a draft variable references sub-paths (`{{geo.region}}`,
// `{{geo.coordinates.lat}}`) but has no value yet, the playground's synthetic
// port schema describes the expected structure two ways:
//
//   - `properties` — top-level keys flattened to `{type: "string"}` placeholders
//   - `_pathHints` — original sub-paths (`["region", "coordinates.lat", ...]`)
//                    preserving the nested shape information `properties` lost
//
// `buildEmptyShapeFromSchema` produces an empty-value object matching that
// expected structure so Form view can show the fields and JSON / YAML modes
// can seed their buffers with the right skeleton. Callers use it as a
// render-only hint — until the user actually edits a field, the testcase
// stays untouched.
//
// Returns `null` for primitive schemas (string / number / boolean) — those
// don't have a "shape" worth seeding; the value-driven helpers handle them.

/** Build a nested empty-value object from path-hints like `["a.b", "a.c"]`.
 *  Defensive against malformed entries (non-strings are skipped) — the helper
 *  receives data sourced from `unknown`-typed schema fragments. */
function buildShapeFromPathHints(hints: unknown[]): Record<string, unknown> {
    const out: Record<string, unknown> = Object.create(null)
    const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"])
    for (const path of hints) {
        if (typeof path !== "string") continue
        const segments = path.split(/[.[\]/]/).filter(Boolean)
        if (segments.length === 0) continue
        let cursor: Record<string, unknown> = out
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i]
            if (BLOCKED_KEYS.has(seg)) break
            const isLast = i === segments.length - 1
            if (isLast) {
                if (!(seg in cursor)) cursor[seg] = ""
            } else {
                const existing = cursor[seg]
                if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
                    cursor[seg] = Object.create(null) as Record<string, unknown>
                }
                cursor = cursor[seg] as Record<string, unknown>
            }
        }
    }
    return out
}

/**
 * True when any property (recursively) is declared as `type: "array"`.
 * Used by `buildEmptyShapeFromSchema` to detect schemas whose properties
 * encode an array-of-objects nested shape (from mustache nested section
 * openers) — `_pathHints` can't represent those, so the properties walk
 * must take precedence.
 */
function hasArrayProperty(properties: Record<string, unknown> | undefined): boolean {
    if (!properties || typeof properties !== "object") return false
    for (const value of Object.values(properties)) {
        if (!value || typeof value !== "object") continue
        const prop = value as {type?: string; properties?: Record<string, unknown>}
        if (prop.type === "array") return true
        if (prop.type === "object" && hasArrayProperty(prop.properties)) return true
    }
    return false
}

/**
 * Build a render-only empty-value seed matching the schema's expected
 * structure. Returns `null` when there's nothing useful to seed (primitive
 * type / missing properties / non-object input).
 *
 * Order of preference for object schemas:
 *   1. `properties` if they carry any array-typed child (e.g. nested
 *      array-of-objects from mustache `{{#repos}}{{#contributors}}…`)
 *   2. `_pathHints` (preserves nested sub-paths)
 *   3. `properties` (recursive, flat per level)
 */
export function buildEmptyShapeFromSchema(schema: unknown): unknown {
    if (!schema || typeof schema !== "object") return null
    const s = schema as {
        type?: string
        properties?: Record<string, unknown>
        items?: unknown
        _pathHints?: unknown
    }

    if (s.type === "object") {
        // Prefer `properties` over `_pathHints` when the properties carry
        // ANY array-typed child (nested array-of-objects shapes coming
        // out of `buildSubPathSchema` for mustache nested section openers).
        // The hints format is a flat list of dotted paths and can't
        // represent arrays — falling back to it would silently strip
        // the nested array structure and reconstruct everything as
        // objects, producing `{contributors: {name: ""}}` instead of
        // `{contributors: []}`. The recursive properties walk below
        // honours array shapes correctly.
        const propertiesHaveArrayChild = hasArrayProperty(
            s.properties as Record<string, unknown> | undefined,
        )
        if (!propertiesHaveArrayChild && Array.isArray(s._pathHints) && s._pathHints.length > 0) {
            return buildShapeFromPathHints(s._pathHints)
        }

        if (s.properties) {
            const out: Record<string, unknown> = Object.create(null)
            for (const [key, prop] of Object.entries(s.properties)) {
                const nested = buildEmptyShapeFromSchema(prop)
                out[key] = nested ?? ""
            }
            return out
        }
    }

    if (s.type === "array") return []
    // Primitive / unknown schemas — no seed worth emitting.
    return null
}
