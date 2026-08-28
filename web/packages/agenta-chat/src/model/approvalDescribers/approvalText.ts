/**
 * Text helpers shared by the approval describers and the generic preview. A leaf module so the
 * describers and `approvalPreview` can both use it without importing each other.
 */

// Collapsed rows truncate to one line with CSS; expanded rows show the full string. This cap is
// only a safety net so a pathological pasted file cannot bloat the DOM — it sits well past a normal
// instruction or skill body, which must survive intact for the expand affordance to be useful.
const DETAIL_CHARS = 4000

/** Collapse whitespace and clamp — a value pasted from a file must not become a paragraph. */
export const oneLine = (text: string, max = DETAIL_CHARS): string => {
    const flat = text.replace(/\s+/g, " ").trim()
    return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** Sentence case with a full stop, so describers can compose phrases without minding punctuation. */
export const asSentence = (text: string): string => {
    const trimmed = text.trim()
    if (!trimmed) return ""
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/** `file_path` → `File path`. Field names are the only labels an unregistered payload gives us. */
export const fieldLabel = (field: string): string => {
    const words = field
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim()
    return words ? `${words[0].toUpperCase()}${words.slice(1).toLowerCase()}` : field
}

/** A scalar rendered for a human: strings as-is, arrays joined, everything else skipped. */
export const readableValue = (value: unknown): string | undefined => {
    if (typeof value === "string") return value.trim() || undefined
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (Array.isArray(value)) {
        const parts = value.filter((item) => typeof item === "string" || typeof item === "number")
        return parts.length === value.length && parts.length ? parts.join(", ") : undefined
    }
    return undefined
}

/** One row per readable field, labelled by its name. Nested objects are skipped, never stringified. */
export const readableFieldRows = (input: unknown): {title: string; detail: string}[] => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return []
    const rows: {title: string; detail: string}[] = []
    for (const [field, value] of Object.entries(input as Record<string, unknown>)) {
        const readable = readableValue(value)
        if (readable) rows.push({title: fieldLabel(field), detail: oneLine(readable)})
    }
    return rows
}
