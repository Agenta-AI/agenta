/**
 * The form remounts on a discard, and remounting tears down whatever is open over it. These
 * cases pin which of the three ways a draft empties counts as one.
 */
import {describe, expect, it} from "vitest"

import {
    isDraftDiscard,
    type DraftTracker,
} from "../../src/DrillInView/components/PlaygroundConfigSection/draftDiscard"

const tracker = (overrides: Partial<DraftTracker> = {}): DraftTracker => ({
    revisionId: "revision-1",
    isDraftEmpty: false,
    draftConsumed: 0,
    ...overrides,
})

describe("a draft going empty", () => {
    it("is a discard when the person threw the edits away", () => {
        expect(isDraftDiscard(tracker(), tracker({isDraftEmpty: true}))).toBe(true)
    })

    it("is not a discard when a COMMIT consumed it", () => {
        // The case D94 turned on. A commit empties the draft and bumps the consume count in the
        // same write, and on a host that switches revision only after the commit resolves, both
        // land while the old revision is still on screen.
        expect(isDraftDiscard(tracker(), tracker({isDraftEmpty: true, draftConsumed: 1}))).toBe(
            false,
        )
    })

    it("is not a discard when the revision switched to a clean one", () => {
        expect(
            isDraftDiscard(tracker(), tracker({revisionId: "revision-2", isDraftEmpty: true})),
        ).toBe(false)
    })

    it("is not a discard while the draft is still there", () => {
        expect(isDraftDiscard(tracker(), tracker())).toBe(false)
    })

    it("is not a discard when the draft was already empty", () => {
        expect(isDraftDiscard(tracker({isDraftEmpty: true}), tracker({isDraftEmpty: true}))).toBe(
            false,
        )
    })

    it("is a discard again on the next edit-then-discard after a commit", () => {
        // The count only has to differ from the previous reading, not be zero, or one commit
        // would suppress every discard that followed it.
        const afterCommit = tracker({isDraftEmpty: true, draftConsumed: 1})
        const edited = tracker({isDraftEmpty: false, draftConsumed: 1})
        expect(isDraftDiscard(afterCommit, edited)).toBe(false)
        expect(isDraftDiscard(edited, tracker({isDraftEmpty: true, draftConsumed: 1}))).toBe(true)
    })
})
