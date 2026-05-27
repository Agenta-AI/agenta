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
        opts.push({value: "form", label: "Form", hint: "default"})
    }
    opts.push({value: "json", label: "JSON"})
    opts.push({value: "yaml", label: "YAML"})
    return opts
}

/**
 * Default view picked the same way as `getDefaultViewForValue`, but with
 * `expectedType` as a fallback when the value is empty.
 */
export function getDefaultViewForExpectedType(
    value: unknown,
    expectedType: ExpectedType,
): ViewType {
    return getViewOptionsForExpectedType(value, expectedType)[0]?.value ?? "json"
}
