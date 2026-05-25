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

/* ── Display: native value → string ──────────────────────────────────── */

/**
 * Render a value as a string for display in an editor, per view mode.
 *
 * - text/markdown: primitives stringify naturally; objects/arrays show as
 *   compact JSON (matches the runtime's `{{var}}` rendering for whole-object
 *   insertion).
 * - json: pretty-printed JSON (objects/arrays as object/array literal; strings
 *   that already contain JSON-shaped text get pretty-printed too).
 * - yaml: YAML dump of the native value, falling back to raw string if the
 *   value isn't safely convertible.
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
        if (typeof value === "string") {
            try {
                const parsed = JSON.parse(value)
                return JSON.stringify(parsed, null, 2)
            } catch {
                return value
            }
        }
        try {
            return JSON.stringify(value, null, 2)
        } catch {
            return String(value)
        }
    }

    if (mode === "yaml") {
        if (typeof value === "string") {
            try {
                const parsed = JSON.parse(value)
                return yamlDump(parsed, {noCompatMode: true, lineWidth: 100})
            } catch {
                return value
            }
        }
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
