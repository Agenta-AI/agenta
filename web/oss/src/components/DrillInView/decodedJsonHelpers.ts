import JSON5 from "json5"

/**
 * Helpers for the "Decoded JSON" view mode.
 *
 * ## What "Decoded JSON" means
 *
 * "Decoded JSON" shows data in the JSON code editor (grey-background,
 * syntax-highlighted) — the same display target as the plain "JSON" mode.
 * The ONLY difference vs plain JSON is that the source is decoded first to
 * strip common quasi-JSON encodings produced by LLMs and instrumentation
 * layers:
 *
 * - fenced code blocks around a string value (```json ... ```)
 * - JSON strings nested inside other JSON strings (stringified JSON in fields)
 * - escaped line breaks (\\n, \\r\\n) which are decoded into real newlines
 * - JSON5 syntactic relaxations (single quotes, trailing commas)
 *
 * Think of it as the inverse of serialization: if the wire data is a JSON
 * value wrapped in one or more layers of string-encoding and escape sequences,
 * this mode peels those layers away so you see the actual structure.
 *
 * "Decoded JSON" does NOT reshape the data, drop keys, or render it outside
 * the JSON editor. Any operation that changes the set of keys or renders the
 * data as chat bubbles / labeled fields belongs in "Beautified JSON" —
 * see `BeautifiedJsonView.tsx`.
 *
 * Historical note: this mode was previously called "Rendered JSON". The name
 * invited confusion — "rendered" sounded like "rendered into another UI",
 * which led a previous change to silently turn it into a chat-bubble view.
 * If you rename again, keep the semantics described above.
 *
 * ## Why this file exists
 *
 * These helpers are shared between `TraceSpanDrillInView` and
 * `AccordionTreePanel` so their `decoded-json` output cannot drift. If you
 * need a new decoding step, add it here and use it from both panels.
 *
 * ## Authoritative reference
 *
 * `VIEW_MODES.md` in this folder documents every view mode and the rules
 * for choosing a default. Keep it in sync when you change behavior here.
 */

/** Decode escaped \n/\r\n sequences at both encoding depths into real newlines. */
export const normalizeEscapedLineBreaks = (value: string): string =>
    value.replaceAll("\\r\\n", "\n").replaceAll("\\n", "\n")

/**
 * Try to parse a string as structured JSON, tolerating:
 * - whitespace
 * - markdown fenced code blocks (```json ... ```)
 * - one level of string-wrapping (e.g. a JSON-stringified JSON)
 * - JSON5 syntax (single quotes, trailing commas, etc.)
 *
 * Returns the parsed object/array, or null if not structured.
 */
export const parseStructuredJson = (value: string): unknown | null => {
    const tryParseJson = (input: string): unknown | null => {
        try {
            return JSON.parse(input)
        } catch {
            return null
        }
    }

    const toStructured = (parsed: unknown): unknown | null => {
        if (parsed && typeof parsed === "object") return parsed
        if (typeof parsed !== "string") return null

        const nested = tryParseJson(parsed.trim())
        if (nested && typeof nested === "object") return nested
        return null
    }

    let candidate = value.trim()
    if (!candidate) return null

    const fencedMatch = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (fencedMatch?.[1]) {
        candidate = fencedMatch[1].trim()
    }

    const strictParsed = toStructured(tryParseJson(candidate))
    if (strictParsed !== null) return strictParsed

    try {
        return toStructured(JSON5.parse(candidate))
    } catch {
        return null
    }
}

/**
 * Recursively unwrap stringified JSON values inside a structure.
 * A field whose string value parses as JSON is replaced by its parsed value.
 *
 * Returns the transformed value and a `didUnwrap` flag indicating whether
 * any string leaf was replaced.
 */
export const unwrapStringifiedJson = (value: unknown): {value: unknown; didUnwrap: boolean} => {
    if (typeof value === "string") {
        const parsed = parseStructuredJson(value)
        if (parsed === null) return {value, didUnwrap: false}
        const nested = unwrapStringifiedJson(parsed)
        return {value: nested.value, didUnwrap: true}
    }

    if (Array.isArray(value)) {
        let didUnwrap = false
        const rendered = value.map((item) => {
            const next = unwrapStringifiedJson(item)
            if (next.didUnwrap) didUnwrap = true
            return next.value
        })
        return {value: rendered, didUnwrap}
    }

    if (value && typeof value === "object") {
        let didUnwrap = false
        const rendered = Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => {
                const next = unwrapStringifiedJson(nestedValue)
                if (next.didUnwrap) didUnwrap = true
                return [key, next.value]
            }),
        )
        return {value: rendered, didUnwrap}
    }

    return {value, didUnwrap: false}
}

/**
 * Decode escaped line-break sequences through both single- and double-encoded
 * representations, stopping once a pass produces no further change.
 */
export const decodeEscapedLineBreaks = (value: string): string => {
    let decoded = value

    for (let i = 0; i < 2; i += 1) {
        const next = decoded
            .replace(/\\\\r\\\\n/g, "\r\n")
            .replace(/\\\\n/g, "\n")
            .replace(/\\r\\n/g, "\r\n")
            .replace(/\\n/g, "\n")

        if (next === decoded) break
        decoded = next
    }

    return decoded
}

/**
 * Walk a structure and decode escaped newlines in every string leaf. Real
 * newlines are then replaced with \u2028 (line separator) so `JSON.stringify`
 * keeps the multiline look inside the code viewer without breaking JSON.
 */
export const formatJsonStringsForDisplay = (value: unknown): unknown => {
    if (typeof value === "string") {
        return decodeEscapedLineBreaks(value).replace(/\r\n|\n|\r/g, "\u2028")
    }

    if (Array.isArray(value)) {
        return value.map((item) => formatJsonStringsForDisplay(item))
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => [
                key,
                formatJsonStringsForDisplay(nestedValue),
            ]),
        )
    }

    return value
}

/**
 * Build the final "Decoded JSON" string for display in the JSON code viewer.
 *
 * Starts from the structure-parsed string (if the raw value was a string that
 * parsed as JSON), falling back to the raw value otherwise, then recursively
 * unwraps nested stringified JSON fields and decodes escaped newlines.
 */
export const buildDecodedJsonOutput = (
    rawValue: unknown,
    parsedStructuredString: unknown | null,
): string => {
    const source = typeof rawValue === "string" ? (parsedStructuredString ?? rawValue) : rawValue
    const unwrapped = unwrapStringifiedJson(source).value
    const formatted = formatJsonStringsForDisplay(unwrapped)
    const next = JSON.stringify(formatted, null, 2)
    return next ?? "null"
}
