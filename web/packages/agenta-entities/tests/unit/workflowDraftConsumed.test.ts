/**
 * A draft going empty means two different things, and the value alone cannot tell them apart.
 *
 * The person discarded their edits, or a commit turned them into a new revision. Only the first
 * is a discard. The configuration form remounts itself on a discard, to clear editor state that
 * props do not reach, and remounting on a COMMIT tears down whatever is open over it — which is
 * how a drawer nobody had touched closed itself seconds after an auto-commit (D94).
 *
 * The hosts differ in a way that makes this reachable on one and not the other. Classic switches
 * to the new revision inside the commit, through the `onNewRevision` callback, so by the time the
 * draft is cleared the screen is already on the new revision and the clearing is invisible. `/m`
 * registers no such callback and follows the switch from the auto-commit handler afterwards, so
 * the clearing lands while the old revision is still on screen.
 */
import {createStore} from "jotai"
import {beforeEach, describe, expect, it} from "vitest"

import {
    consumeWorkflowDraftAtom,
    discardWorkflowDraftAtom,
    workflowDraftAtomFamily,
    workflowDraftConsumedAtomFamily,
} from "../../src/workflow/state/store"

const REVISION = "revision-1"

let store: ReturnType<typeof createStore>

const seedDraft = () => {
    store.set(workflowDraftAtomFamily(REVISION), {
        data: {parameters: {agent: {}}},
    } as never)
}

beforeEach(() => {
    store = createStore()
})

describe("clearing a workflow draft", () => {
    it("empties it either way, because that half is the same write", () => {
        seedDraft()
        store.set(discardWorkflowDraftAtom, REVISION)
        expect(store.get(workflowDraftAtomFamily(REVISION))).toBeNull()

        seedDraft()
        store.set(consumeWorkflowDraftAtom, REVISION)
        expect(store.get(workflowDraftAtomFamily(REVISION))).toBeNull()
    })

    it("counts a commit consuming the draft", () => {
        expect(store.get(workflowDraftConsumedAtomFamily(REVISION))).toBe(0)

        seedDraft()
        store.set(consumeWorkflowDraftAtom, REVISION)

        expect(store.get(workflowDraftConsumedAtomFamily(REVISION))).toBe(1)
    })

    it("does not count a discard, which is what makes the two tellable apart", () => {
        seedDraft()
        store.set(discardWorkflowDraftAtom, REVISION)

        expect(store.get(workflowDraftConsumedAtomFamily(REVISION))).toBe(0)
    })

    it("counts each commit, so two in a row are two events and not one", () => {
        seedDraft()
        store.set(consumeWorkflowDraftAtom, REVISION)
        seedDraft()
        store.set(consumeWorkflowDraftAtom, REVISION)

        expect(store.get(workflowDraftConsumedAtomFamily(REVISION))).toBe(2)
    })

    it("counts per revision, so one revision's commit says nothing about another", () => {
        seedDraft()
        store.set(consumeWorkflowDraftAtom, REVISION)

        expect(store.get(workflowDraftConsumedAtomFamily("revision-2"))).toBe(0)
    })
})
