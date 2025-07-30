/**
 * Check if content appears to be incomplete (user is still typing)
 */
export function isContentIncomplete(text: string, language: "json" | "yaml" = "json"): boolean {
    const trimmed = text.trim()

    if (language === "json") {
        // JSON incomplete patterns
        return (
            trimmed.endsWith(":") || // "key":
            trimmed.endsWith(",") || // trailing comma
            trimmed.endsWith("[") || // opening array
            trimmed.endsWith("{") || // opening object
            trimmed.endsWith('"') || // unclosed string
            /[{[]$/.test(trimmed) || // ends with opening bracket
            /:\s*$/.test(trimmed) // colon with whitespace
        )
    } else {
        // YAML incomplete patterns
        return (
            trimmed.endsWith(":") || // "key:"
            trimmed.endsWith("-") || // list item dash
            /:\s*$/.test(trimmed) || // colon with whitespace
            /^\s*-\s*$/.test(trimmed) // dash with whitespace
        )
    }
}
