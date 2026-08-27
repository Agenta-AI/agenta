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
