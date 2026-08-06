/**
 * Pure value ↔ display conversions used by surfaces that compose the
 * view-mode primitives (e.g. the playground inputs body).
 *
 * The runtime invariant: native JSON stays native until template rendering
 * (RFC). Editors operate on strings; these helpers convert between the two
 * per view mode and, on edit-back, preserve the original runtime type when
 * possible (so transport sees a number/boolean/null when the user authored one).
 *
 * No React, no jotai, no antd — just functions over `unknown`. Unit-tested
 * in `agenta-entities/tests/unit/playground-inputs-formatters.test.ts`
 * (stopgap until entity-ui gets its own test runner).
 */

import {inferLogicalType, type LogicalType} from "@agenta/shared/utils"
import {dump as yamlDump, load as yamlLoad} from "js-yaml"

import type {ViewType} from "./viewTypes"

/** True when the value is an empty array or empty object — the cases for
 *  which YAML and JSON `[]` / `{}` literals look identical and where seeding
 *  the YAML buffer doesn't help the user. */
function isEmptyContainer(value: unknown): boolean {
    if (Array.isArray(value)) return value.length === 0
    if (value !== null && typeof value === "object") {
        return Object.keys(value as Record<string, unknown>).length === 0
    }
    return false
}

/* ── Display: native value → string ──────────────────────────────────── */

/**
 * Render a value as a string for display in an editor, per view mode.
 *
 * View modes are pure REPRESENTATION transforms — they NEVER change the
 * value's type. A string is a string in every mode; an object is an object
 * in every mode. Per the gap-04 invariant ("native JSON stays native"), we
 * never auto-parse a JSON-shaped string into an object for display.
 *
 * - text / markdown: primitives stringify naturally; objects / arrays show
 *   as compact JSON (matches the runtime's `{{var}}` rendering for
 *   whole-object insertion).
 * - json: `JSON.stringify(value, null, 2)` regardless of type.
 *     - string  "Vanuatu"        → `"Vanuatu"`  (JSON literal, quoted)
 *     - string  '{"a":1}'        → `"{\"a\":1}"` (escaped JSON literal — still a STRING)
 *     - object  {a: 1}           → `{\n  "a": 1\n}` (multi-line)
 *     - array   ["a", "b"]       → `[\n  "a",\n  "b"\n]`
 *     - number  42               → `42`
 *     - boolean true             → `true`
 * - yaml: `yamlDump(value)` regardless of type. YAML's plain scalars cover
 *   primitives; objects / arrays produce proper block-style YAML.
 *
 * Returns `""` for `null` and `undefined` so the editor renders empty.
 */
export function valueToDisplay(value: unknown, mode: ViewType): string {
    if (value === undefined || value === null) return ""

    if (mode === "text" || mode === "markdown") {
        if (typeof value === "string") return value
        if (typeof value === "number" || typeof value === "boolean") return String(value)
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }

    if (mode === "json") {
        // No string special-case — strings get JSON-encoded into a literal
        // (`"value"` with internal escapes if needed). If the string happens
        // to contain JSON-shaped text, we still render it as a STRING
        // literal; the type doesn't silently change at display time.
        try {
            return JSON.stringify(value, null, 2)
        } catch {
            return String(value)
        }
    }

    if (mode === "yaml") {
        // Empty containers (`[]` / `{}`) only have a flow-style YAML
        // representation, which looks identical to JSON literals. Return
        // an empty buffer instead so the editor's placeholder guides the
        // user to type proper YAML.
        if (isEmptyContainer(value)) return ""
        // No string special-case here either — yamlDump handles strings as
        // plain scalars (`Vanuatu`) and JSON-shaped strings as quoted
        // scalars when needed (`'{"a":1}'`). Type preservation, same as
        // JSON mode.
        try {
            return yamlDump(value, {noCompatMode: true, lineWidth: 100})
        } catch {
            return String(value)
        }
    }

    // chat / form view modes are handled by dedicated widgets — this helper
    // shouldn't be called for them. Defensive fallback:
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

/* ── Edit-back: string → native value, preserving original kind ──────── */

/**
 * Coerce an edited string back into a native runtime value, preserving the
 * original kind when possible. Used by text-mode edits where the editor only
 * surfaces strings but the testcase needs to keep its native type.
 *
 * Rules:
 *   - originalType `"number"`  → `Number(next)` if valid, else the raw string
 *                                 (empty string becomes the empty string,
 *                                 NOT 0, so the caller can treat it as "clear")
 *   - originalType `"boolean"` → `true` / `false` for canonical inputs,
 *                                 else the raw string (text-mode coercion is
 *                                 only relevant for paste edits — the actual
 *                                 widget is a Switch)
 *   - originalType `"null"`    → `null` if `next` is empty, else the string
 *   - everything else          → the raw string
 *
 * For json-object / json-array (which don't get text mode in V2's options),
 * the helper still works defensively — but those modes route through
 * `parseJsonEdit` or `parseYamlEdit` below, not through `coerceTextEdit`.
 */
export function coerceTextEdit(next: string, originalType: LogicalType): unknown {
    if (originalType === "number") {
        if (next === "") return ""
        const n = Number(next)
        return Number.isNaN(n) ? next : n
    }
    if (originalType === "boolean") {
        if (next === "true") return true
        if (next === "false") return false
        return next
    }
    if (originalType === "null") {
        return next === "" ? null : next
    }
    return next
}

/**
 * Parse the JSON-mode editor buffer back to a native value. Returns
 * `{ok: true, value}` on success, `{ok: false}` on parse failure (caller
 * keeps last valid value, mirrors the existing JSON-editor pattern).
 */
export function parseJsonEdit(next: string): {ok: true; value: unknown} | {ok: false} {
    try {
        return {ok: true, value: JSON.parse(next)}
    } catch {
        return {ok: false}
    }
}

/**
 * Parse the YAML-mode editor buffer back to a native value.
 */
export function parseYamlEdit(next: string): {ok: true; value: unknown} | {ok: false} {
    try {
        return {ok: true, value: yamlLoad(next)}
    } catch {
        return {ok: false}
    }
}

/* ── Re-exports for callers that want one import site ─────────────── */

export {inferLogicalType, type LogicalType}
