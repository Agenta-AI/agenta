/**
 * Template variable validation against the workflow service request envelope.
 *
 * Prompt placeholders can be written as paths the backend resolver navigates
 * at runtime (JSONPath `$.*`, JSON Pointer `/*`, dot notation).
 *
 * Validation philosophy (post-mustache QA, 2026-05-28):
 *   - JSONPath (`$.foo.bar`) is treated permissively in the playground — the
 *     root segment is assumed to be a variable / testcase-spread key and is
 *     auto-surfaced as a column. We do NOT validate against any known-slot
 *     list and do NOT emit typo suggestions. Format mismatches surface as
 *     runtime errors from the API at invocation time, not UI errors. This
 *     matches Mahmoud's QA principle: "the general behavior in the playground
 *     is to create variables for prompt variables automatically … send it as
 *     is and let the API return an error" (Slack #release-v100).
 *   - The validator only rejects structurally malformed expressions:
 *       · empty placeholders
 *       · empty segments between separators (`$..foo`, `/foo//bar`)
 *       · `$` followed by anything other than `.` (e.g. `$outputs.country`)
 *       · `$.` with no field after the dot
 *   - JSON Pointer (`/<path>`) keeps the stricter envelope-slot check
 *     because it's a legacy contract that requires rooting at a known slot.
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
 * Used today only by the JSON Pointer (`/<path>`) validation branch, which
 * keeps the legacy strict envelope-rooting requirement. The JSONPath (`$.*`)
 * branch is intentionally permissive per the mustache QA principle — see
 * the file-level docstring.
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
 *
 * Used only by the JSON Pointer branch — the JSONPath branch no longer
 * emits typo suggestions (per the file-level docstring rationale).
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
 * Validate a template placeholder.
 *
 * - JSONPath (`$.<path>`): permissive. Any well-formed `$.<segment>...`
 *   is valid — the root segment becomes a variable / testcase column. Only
 *   `$<not-dot>...`, `$.` (no field), and `$..foo` (empty segment) are
 *   rejected. Per the mustache QA principle (file-level docstring).
 * - JSON Pointer (`/<path>`): strict. Must root at a known envelope slot
 *   from `KNOWN_ENVELOPE_SLOTS`, otherwise rejected with an optional
 *   `did-you-mean` suggestion.
 * - Plain names and dot-notation: permissive (no envelope prefix, can't
 *   validate structurally without more context).
 *
 * When invalid, returns a `reason` string suitable for a tooltip; the
 * JSON Pointer branch may additionally return a `suggestion` for near-miss
 * envelope-slot typos.
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
        // `{{$}}` (whole context as compact JSON) is valid mustache JSONPath.
        if (expr === "$") return {valid: true}
        // `$<anything-not-dot>...` is malformed — JSONPath roots descend with
        // `.` (or end at the bare `$`). e.g. `$outputs.country` is not a path,
        // it's a `$`-prefixed identifier we don't recognise. Per Mahmoud's QA
        // on the mustache rollout (Slack #release-v100, 2026-05-28), typeahead
        // steers users to insert the `.` automatically when they accept a
        // suggestion at `$<char>`; this branch is the safety net for when a
        // user bypasses typeahead and types or pastes a bare `$<name>` form.
        if (expr[1] !== ".") {
            return {
                valid: false,
                reason: "JSONPath root must be followed by `.` (e.g. `$.foo` not `$foo`).",
            }
        }
        // From here we know `expr` starts with `$.`. Tokenise to find the
        // root segment — used only to verify there IS a field after `$.`.
        const tokens = expr
            .replace(/^\$\.?/, "")
            .split(/[.[\]'"]/)
            .filter(Boolean)
        if (tokens.length === 0) {
            // `{{$.}}` (root + trailing dot, no field) — `hasEmptySegment`
            // only catches DUPLICATED separators (`..`, `//`), not a lone
            // trailing one, so reject it explicitly here.
            return {
                valid: false,
                reason: "JSONPath root has no field after `$.`.",
            }
        }
        // Per Mahmoud's QA (Slack #release-v100, 2026-05-28), the playground
        // does NOT validate JSONPath roots against any known-slot list or
        // testset schema. Any well-formed `$.<segment>...` references a
        // column named after the root segment — auto-created on the right-
        // side panel, with the backend resolving the full path at render
        // time. Format mismatches surface as runtime errors from the API,
        // not UI errors. Previously we flagged near-typos of envelope slots
        // (e.g. `$.output.country` because `output` prefix-matches `outputs`)
        // and emitted a "did you mean…?" suggestion — that's gone now. The
        // user's literal text wins; we don't second-guess them.
        return {valid: true}
    }

    if (expr.startsWith("/")) {
        // Mustache section close tags look like `{{/identifier}}` —
        // single-segment, identifier-shaped, with no further `/`. JSON
        // Pointer paths to envelope slots are also single-segment (e.g.
        // `/inputs`), and we can't tell mustache vs JSON Pointer without
        // format context here. Pragmatic disambiguation: single-segment
        // identifier-shaped paths are accepted unconditionally (the runtime
        // is the source of truth — if the close tag has no matching open,
        // the mustache renderer surfaces a clear error at render time; if
        // the user meant a legacy JSON Pointer to `/input`, the typo
        // detection was already a "best effort" hint). Multi-segment JSON
        // Pointers (`/inputs/foo/bar`) still get the envelope-slot check.
        const isSingleSegmentIdentifier = /^\/[a-zA-Z_][\w.]*$/.test(expr)
        if (isSingleSegmentIdentifier) {
            return {valid: true}
        }

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
 * Implemented as plain prefix/suffix stripping rather than a regex match
 * to avoid polynomial backtracking on adversarial inputs (CodeQL js/redos).
 */
export function extractTemplateExpression(tokenText: string): string {
    if (!tokenText) return tokenText
    // {{ expr }}
    if (tokenText.startsWith("{{") && tokenText.endsWith("}}") && tokenText.length >= 4) {
        return tokenText.slice(2, -2).trim()
    }
    // {% expr %} / {%- expr -%}
    if (tokenText.startsWith("{%") && tokenText.endsWith("%}") && tokenText.length >= 4) {
        let inner = tokenText.slice(2, -2)
        if (inner.startsWith("-")) inner = inner.slice(1)
        if (inner.endsWith("-")) inner = inner.slice(0, -1)
        return inner.trim()
    }
    // {# expr #}
    if (tokenText.startsWith("{#") && tokenText.endsWith("#}") && tokenText.length >= 4) {
        return tokenText.slice(2, -2).trim()
    }
    return tokenText
}
