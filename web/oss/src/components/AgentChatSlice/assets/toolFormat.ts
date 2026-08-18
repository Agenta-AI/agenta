/**
 * Shared formatting for tool input/output display (inline step log + Turn Inspector), so both
 * render a payload identically.
 *
 * Tool results reach the FE in a few shapes: a plain string, a string wrapped in a markdown code
 * fence (the model-facing form), or a JSON *string* (the backend often JSON-encodes structured
 * output). Show them cleanly: strip a wrapping fence, and pretty-print anything that is really JSON
 * (a JSON string or an object) instead of dumping a single compact line.
 */

/** One `[\w-]` character — the language-tag alphabet the fence prefix accepts. */
const isFenceTagChar = (c: string): boolean =>
    (c >= "0" && c <= "9") ||
    (c >= "A" && c <= "Z") ||
    (c >= "a" && c <= "z") ||
    c === "_" ||
    c === "-"

/** Strip a surrounding markdown code fence — backends wrap tool output/errors in ```…```. Only a
 * fence that spans the WHOLE string is stripped, so inner fenced blocks are left intact.
 *
 * A single linear scan, NOT the old `^```[\w-]*\n?([\s\S]*?)\n?```$` match: `[\w-]*` and `[\s\S]*?`
 * both accept '-', so an unclosed fence followed by many '-' made the engine retry every split
 * point and rescan the tail — quadratic on uncontrolled tool output (CodeQL polynomial-ReDoS). */
export const stripFence = (value: string): string => {
    const s = value.trim()
    if (s.length < 6 || !s.startsWith("```") || !s.endsWith("```")) return value
    let i = 3
    while (i < s.length - 3 && isFenceTagChar(s[i])) i++
    return s.slice(i, s.length - 3).trim()
}

/** Pretty-print `value` for a monospace block: JSON string → indented JSON, object → indented JSON,
 * otherwise the (fence-stripped) string. Never throws. */
export const formatToolValue = (value: unknown): string => {
    if (value == null) return ""
    if (typeof value === "string") {
        const stripped = stripFence(value)
        try {
            const parsed = JSON.parse(stripped)
            // Only reformat real structured JSON — never turn "42"/"true"/a bare word into a
            // primitive or churn a plain sentence that happens to parse.
            if (parsed && typeof parsed === "object") return JSON.stringify(parsed, null, 2)
        } catch {
            // not JSON — show the stripped text as-is (e.g. a line-numbered file read, a message).
        }
        return stripped
    }
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}
