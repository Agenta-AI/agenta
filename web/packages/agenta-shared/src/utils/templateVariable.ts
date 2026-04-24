/**
 * Template variable validation against the workflow service request envelope.
 *
 * Prompt placeholders can be written as paths the backend resolver navigates
 * at runtime (JSONPath `$.*`, JSON Pointer `/*`, dot notation). When such a
 * path roots at an unknown envelope segment (e.g. `$.input.*` — `input`
 * singular is a typo, not a slot), the path can never resolve — the frontend
 * should treat it as invalid and avoid producing an input control for it.
 *
 * Kept in `@agenta/shared/utils` so both `@agenta/entities/runnable`
 * (variable grouping) and `@agenta/ui/editor` (token-node styling) can
 * import from the same authoritative list without a circular dep.
 */

/**
 * Canonical top-level slots of the workflow invocation envelope.
 *
 * Source of truth: `WorkflowServiceRequestData` in the Fern-generated
 * SDK client at `sdk/agenta/client/backend/types/workflow_service_request_data.py`.
 * That pydantic model is what the evaluation runner builds when calling a
 * workflow service (see `api/oss/src/core/evaluations/tasks/legacy.py`
 * around line 846) — the backend resolver at runtime (`resolve_any` in
 * `sdk/agenta/sdk/utils/resolvers.py`) navigates a payload whose top
 * level IS an instance of this model.
 *
 * Any change to the list below MUST be mirrored against that Python
 * class. The model isn't exposed via the public OpenAPI spec (it's an
 * internal envelope between api and workflow services), so there's no
 * runtime source we can derive this from — the list is hand-synced.
 *
 * Variable paths whose first segment isn't in this set (e.g.
 * `$.input.xx.abc` — `input` singular is a typo) are considered
 * structurally invalid and surfaced as such in the prompt editor.
 */
export const KNOWN_ENVELOPE_SLOTS = new Set([
    "inputs",
    "outputs",
    "parameters",
    "testcase",
    "trace",
    "revision",
])

/**
 * Find the closest known envelope slot for a typed segment — used to offer
 * "did you mean…?" hints on invalid paths. Conservative: returns a
 * suggestion only when the typed segment is a prefix of a known slot or
 * vice-versa (catches `input` → `inputs`, `output` → `outputs`, `inpu` →
 * `inputs`, etc.), avoiding wild guesses for truly unrelated names.
 */
function suggestEnvelopeSlot(typed: string): string | null {
    if (!typed) return null
    const lower = typed.toLowerCase()
    if (KNOWN_ENVELOPE_SLOTS.has(lower)) return null
    for (const slot of KNOWN_ENVELOPE_SLOTS) {
        if (slot.startsWith(lower) || lower.startsWith(slot)) return slot
    }
    return null
}

/**
 * Validation result for a template placeholder expression.
 * `reason` and `suggestion` populate the UI tooltip on invalid tokens.
 */
export interface TemplateVariableValidation {
    valid: boolean
    /** Human-readable explanation of why the expression is invalid. */
    reason?: string
    /** Closest known envelope slot, when the typed root looks like a typo. */
    suggestion?: string
}

/**
 * Validate a template placeholder against the envelope schema.
 *
 * - JSONPath / JSON Pointer: the root segment MUST be a known envelope slot.
 * - Plain names and dot-notation: permissive (no envelope prefix, can't
 *   validate structurally without more context).
 *
 * When invalid, returns a `reason` string suitable for a tooltip plus an
 * optional `suggestion` for near-miss typos (e.g. `input` → `inputs`).
 */
/**
 * Detect a malformed path with consecutive separators (e.g. `$.inputs..country`
 * or `/inputs//country`). These produce an empty segment between two
 * delimiters — resolves to nothing at runtime, and our parser would
 * otherwise silently collapse the empties and pretend the path is fine.
 *
 * Operates on the expression BEFORE leading-prefix stripping so we can
 * catch the case where a JSONPath starts with `$..foo` (root-then-empty).
 */
function hasEmptySegment(expr: string): boolean {
    return /\.\.|\/\//.test(expr)
}

export function validateTemplateVariable(expr: string): TemplateVariableValidation {
    if (!expr) return {valid: false, reason: "Empty placeholder."}

    const knownList = Array.from(KNOWN_ENVELOPE_SLOTS).join(", ")

    if (hasEmptySegment(expr)) {
        return {
            valid: false,
            reason: "Empty segment between separators. Remove the duplicated `.` or `/`.",
        }
    }

    if (expr.startsWith("$")) {
        const tokens = expr
            .replace(/^\$\.?/, "")
            .split(/[.[\]'"]/)
            .filter(Boolean)
        if (tokens.length === 0) {
            return {
                valid: false,
                reason: `JSONPath root has no envelope slot. Expected one of: ${knownList}.`,
            }
        }
        if (!KNOWN_ENVELOPE_SLOTS.has(tokens[0])) {
            const suggestion = suggestEnvelopeSlot(tokens[0])
            return {
                valid: false,
                reason: `Unknown envelope slot \`${tokens[0]}\`. Must root at one of: ${knownList}.`,
                ...(suggestion ? {suggestion} : {}),
            }
        }
        return {valid: true}
    }

    if (expr.startsWith("/")) {
        const tokens = expr.split("/").filter(Boolean)
        if (tokens.length === 0) {
            return {
                valid: false,
                reason: `JSON Pointer root has no envelope slot. Expected one of: ${knownList}.`,
            }
        }
        if (!KNOWN_ENVELOPE_SLOTS.has(tokens[0])) {
            const suggestion = suggestEnvelopeSlot(tokens[0])
            return {
                valid: false,
                reason: `Unknown envelope slot \`${tokens[0]}\`. Must root at one of: ${knownList}.`,
                ...(suggestion ? {suggestion} : {}),
            }
        }
        return {valid: true}
    }

    return {valid: true}
}

/**
 * Boolean convenience wrapper around `validateTemplateVariable`.
 * Keeps call sites that only care about pass/fail concise.
 */
export function isValidTemplateVariable(expr: string): boolean {
    return validateTemplateVariable(expr).valid
}

/**
 * Extract the inner expression from a raw `{{...}}` / `{%...%}` / `{#...#}`
 * token string. Returns the raw text if no curly/jinja wrapper is found.
 *
 * Used by the editor's token node to check semantic validity of rendered
 * placeholders without re-implementing the wrapper-stripping logic.
 */
export function extractTemplateExpression(tokenText: string): string {
    if (!tokenText) return tokenText
    // {{ expr }}
    const curlyMatch = tokenText.match(/^\{\{\s*([\s\S]*?)\s*\}\}$/)
    if (curlyMatch) return curlyMatch[1]
    // {% expr %} / {%- expr -%}
    const jinjaBlockMatch = tokenText.match(/^\{%-?\s*([\s\S]*?)\s*-?%\}$/)
    if (jinjaBlockMatch) return jinjaBlockMatch[1]
    // {# expr #}
    const jinjaCommentMatch = tokenText.match(/^\{#\s*([\s\S]*?)\s*#\}$/)
    if (jinjaCommentMatch) return jinjaCommentMatch[1]
    return tokenText
}
