/**
 * The markdown editor's draft model — pure, so the rules are unit-testable and the hook stays
 * thin. A draft holds the editor's text against the saved text it was seeded from, and counts
 * as dirty only once the editor has EMITTED a change and that text differs from the seed. The
 * editor never emits on hydration (only on edits), so an untouched document — however Lexical
 * would normalise it — is never dirty on open.
 */
export interface DriveDraft {
    /** The saved text the draft was seeded from — detects a file that changed underneath. */
    seed: string
    /** The seed again once the editor has emitted; null until the first edit. */
    baseline: string | null
    /** The current editor text. */
    value: string
}

export const seedDriveDraft = (text: string): DriveDraft => ({seed: text, baseline: null, value: text})

/** The editor emitted text (an edit): from here on the draft compares against the seed. */
export const applyDriveDraftChange = (draft: DriveDraft, text: string): DriveDraft => {
    if (draft.baseline === null) return {...draft, baseline: draft.seed, value: text}
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
