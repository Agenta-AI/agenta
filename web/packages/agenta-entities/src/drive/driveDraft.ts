/**
 * The file editors' draft model — pure, so the rules are unit-testable and the hook stays thin.
 * A draft holds the editor's text against the saved text it was seeded from, and counts as dirty
 * only once the editor has EMITTED a change and that text differs from the seed.
 *
 * Editors normalise: the code editor drops a trailing newline, and re-hydrating it (a re-seed
 * after the file changed underneath) emits that normalised text as if it were an edit. So the
 * first emission after a seed is an edit only when it differs from the seed beyond trailing
 * newlines; otherwise it just becomes the baseline. The markdown editor never emits on hydration,
 * so for it the first emission always is an edit.
 */
export interface DriveDraft {
    /** The saved text the draft was seeded from — detects a file that changed underneath. */
    seed: string
    /** The text edits compare against; null until the editor has emitted. */
    baseline: string | null
    /** The current editor text. */
    value: string
}

export const seedDriveDraft = (text: string): DriveDraft => ({seed: text, baseline: null, value: text})

const stripTrailingNewlines = (text: string) => text.replace(/\n+$/, "")

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

/**
 * The bytes to write for the draft: its value, keeping the saved file's trailing newline when
 * the editor dropped it — a save must not strip what every formatter puts there.
 */
export const driveDraftTextToSave = (draft: DriveDraft): string =>
    draft.seed.endsWith("\n") && !draft.value.endsWith("\n") ? `${draft.value}\n` : draft.value

/**
 * After a save: `saved` is the new seed and baseline; the value stays whatever the editor holds
 * NOW (the user may have typed on while the write was in flight — those keystrokes stay dirty and
 * save next).
 */
export const commitDriveDraft = (draft: DriveDraft, saved: string): DriveDraft => ({
    seed: saved,
    // The editor's normalised form of what was saved, so the value it holds compares clean.
    baseline: stripTrailingNewlines(draft.value) === stripTrailingNewlines(saved) ? draft.value : saved,
    value: draft.value,
})
