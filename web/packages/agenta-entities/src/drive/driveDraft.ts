/**
 * The file editors' draft model (pure). Dirty = the editor emitted text that differs from the
 * baseline; the first emission after a seed is the baseline when it is only the seed normalised
 * (the code editor drops a trailing newline on hydration), else an edit.
 */
export interface DriveDraft {
    /** The saved text the draft was seeded from. */
    seed: string
    /** What edits compare against; null until the editor has emitted. */
    baseline: string | null
    value: string
}

export const seedDriveDraft = (text: string): DriveDraft => ({
    seed: text,
    baseline: null,
    value: text,
})

const stripTrailingNewlines = (text: string) => {
    let end = text.length
    while (end > 0 && text[end - 1] === "\n") end--
    return text.slice(0, end)
}

/** The editor emitted text. */
export const applyDriveDraftChange = (draft: DriveDraft, text: string): DriveDraft => {
    if (draft.baseline === null) {
        // A hydration echo (the seed, normalised) is the baseline, not an edit.
        const echo = stripTrailingNewlines(text) === stripTrailingNewlines(draft.seed)
        return {...draft, baseline: echo ? text : draft.seed, value: text}
    }
    if (draft.value === text) return draft
    return {...draft, value: text}
}

export const isDriveDraftDirty = (draft: DriveDraft | null | undefined): boolean =>
    draft != null && draft.baseline !== null && draft.value !== draft.baseline

/** The value, with the saved file's trailing newline restored if the editor dropped it. */
export const driveDraftTextToSave = (draft: DriveDraft): string =>
    draft.seed.endsWith("\n") && !draft.value.endsWith("\n") ? `${draft.value}\n` : draft.value

/** After a save: `saved` becomes seed + baseline; keystrokes typed mid-write stay dirty. */
export const commitDriveDraft = (draft: DriveDraft, saved: string): DriveDraft => ({
    seed: saved,
    baseline:
        stripTrailingNewlines(draft.value) === stripTrailingNewlines(saved) ? draft.value : saved,
    value: draft.value,
})
