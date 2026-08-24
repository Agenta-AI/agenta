/**
 * Text helpers shared by the approval describers and the generic preview. A leaf module so the
 * describers and `approvalPreview` can both use it without importing each other.
 */

// The row renders on ONE line and truncates with CSS, so this is only a safety net that keeps a
// pasted file out of the DOM — it sits well past what any row can show.
const DETAIL_CHARS = 400

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
