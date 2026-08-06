/**
 * Auto-infer a native primitive from free-form text input.
 *
 * Used by the testcase text editor so number / boolean values stop getting
 * stored as strings — `"5"` becomes `5`, `"true"`/`"false"` (case insensitive)
 * become booleans, and `""` stays `""`.
 *
 * Uses a strict roundtrip check (`String(Number(text)) === text`) so values
 * like `"5.0"`, `"0123"`, `"1e10"`, or `" 5"` are preserved as strings — these
 * usually represent IDs, version segments, or formatted display values rather
 * than numbers the user wants to coerce.
 */
export function inferPrimitiveFromText(text: string): string | number | boolean {
    if (text === "") return ""

    const lower = text.toLowerCase()
    if (lower === "true") return true
    if (lower === "false") return false

    const n = Number(text)
    if (Number.isFinite(n) && String(n) === text) return n

    return text
}
