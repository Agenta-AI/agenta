/**
 * The markdown editor's draft model — pure, so the rules are unit-testable and the hook stays
 * thin. A draft holds the editor's text against a BASELINE: the first serialisation the editor
 * emits after (re)seeding, not the raw file text. Lexical normalises markdown on the way in
 * (list markers, table padding, front matter), so comparing against the file would flag every
 * agent-written document dirty the moment it opens. Dirty = the text moved past that baseline.
 */
export interface DriveDraft {
    /** The saved text the draft was seeded from — detects a file that changed underneath. */
    seed: string
    /** The editor's own first serialisation of `seed`; null until it has emitted one. */
    baseline: string | null
    /** The current editor text. */
    value: string
}

export const seedDriveDraft = (text: string): DriveDraft => ({seed: text, baseline: null, value: text})

/** The editor emitted text. The first emission after a seed is the baseline; later ones edit. */
export const applyDriveDraftChange = (draft: DriveDraft, text: string): DriveDraft => {
    if (draft.baseline === null) return {...draft, baseline: text, value: text}
    if (draft.value === text) return draft
    return {...draft, value: text}
}

export const isDriveDraftDirty = (draft: DriveDraft | null | undefined): boolean =>
    draft != null && draft.baseline !== null && draft.value !== draft.baseline

/** After a save the current text is the new seed and baseline. */
export const commitDriveDraft = (draft: DriveDraft): DriveDraft => ({
    seed: draft.value,
    baseline: draft.value,
    value: draft.value,
})

/** Revert = re-seed from the saved text so the editor re-hydrates and re-baselines. */
export const revertDriveDraft = (draft: DriveDraft): DriveDraft => seedDriveDraft(draft.seed)
