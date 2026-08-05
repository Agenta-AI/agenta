/**
 * Unit tests for createEntityDraftState
 *
 * This factory is the foundation of how every entity in @agenta/entities
 * tracks local edits. It manages four things:
 *  - draftAtomFamily    — stores the pending local edit (null = no edit)
 *  - withDraftAtomFamily — merges draft over server state
 *  - isDirtyAtomFamily  — true when the draft differs from server
 *  - hasDraftAtomFamily — true when any draft exists (even if identical)
 *
 * Tests run in isolation using Jotai's createStore() — no API calls, no React.
 */

import {describe, it, expect, beforeEach} from "vitest"
import {atom, createStore} from "jotai"
import type {PrimitiveAtom} from "jotai"

import {createEntityDraftState} from "../../src/shared/molecule/createEntityDraftState"

// ── Fixture type ──────────────────────────────────────────────────────────────

type Note = {
    id: string
    title: string
    body: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal entity atom family backed by a plain map of primitive atoms.
 * This avoids the jotai-family peer dep in test setup while still satisfying
 * the EntityDraftStateConfig interface.
 */
function makeEntityAtomFamily(initial: Record<string, Note | null> = {}) {
    const cache: Record<string, PrimitiveAtom<Note | null>> = {}

    function entityAtomFamily(id: string): PrimitiveAtom<Note | null> {
        if (!cache[id]) {
            cache[id] = atom<Note | null>(initial[id] ?? null)
        }
        return cache[id]
    }

    return {entityAtomFamily, cache}
}

function makeDraftState(initial: Record<string, Note | null> = {}) {
    const {entityAtomFamily} = makeEntityAtomFamily(initial)
    const store = createStore()

    const draftState = createEntityDraftState<Note>({
        entityAtomFamily,
        getDraftableData: (note) => note,
        mergeDraft: (note, draft) => ({...note, ...draft}),
    })

    return {store, draftState, entityAtomFamily}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createEntityDraftState", () => {
    const serverNote: Note = {id: "note-1", title: "Hello", body: "World"}

    // ── Initial state ─────────────────────────────────────────────────────────

    describe("initial state (no draft)", () => {
        it("hasDraft is false when no draft has been set", () => {
            const {store, draftState} = makeDraftState({"note-1": serverNote})
            expect(store.get(draftState.hasDraftAtomFamily("note-1"))).toBe(false)
        })

        it("isDirty is false when no draft has been set", () => {
            const {store, draftState} = makeDraftState({"note-1": serverNote})
            expect(store.get(draftState.isDirtyAtomFamily("note-1"))).toBe(false)
        })

        it("withDraft returns the server entity when no draft exists", () => {
            const {store, draftState} = makeDraftState({"note-1": serverNote})
            expect(store.get(draftState.withDraftAtomFamily("note-1"))).toEqual(serverNote)
        })

        it("withDraft returns null when the entity does not exist", () => {
            const {store, draftState} = makeDraftState({})
            expect(store.get(draftState.withDraftAtomFamily("missing"))).toBeNull()
        })
    })

    // ── Applying an update ────────────────────────────────────────────────────

    describe("after applying an update", () => {
        let store: ReturnType<typeof createStore>
        let draftState: ReturnType<typeof createEntityDraftState<Note>>

        beforeEach(() => {
            ;({store, draftState} = makeDraftState({"note-1": serverNote}))
            store.set(draftState.updateAtom, "note-1", {title: "Updated title"})
        })

        it("hasDraft becomes true", () => {
            expect(store.get(draftState.hasDraftAtomFamily("note-1"))).toBe(true)
        })

        it("isDirty becomes true", () => {
            expect(store.get(draftState.isDirtyAtomFamily("note-1"))).toBe(true)
        })

        it("withDraft returns the merged entity (draft wins)", () => {
            const merged = store.get(draftState.withDraftAtomFamily("note-1"))
            expect(merged?.title).toBe("Updated title")
            expect(merged?.body).toBe("World")
        })

        it("the raw draft atom holds the full merged draftable data", () => {
            const draft = store.get(draftState.draftAtomFamily("note-1"))
            expect(draft?.title).toBe("Updated title")
            expect(draft?.body).toBe("World")
        })
    })

    // ── Smart draft clearing ──────────────────────────────────────────────────

    describe("smart draft clearing", () => {
        it("clears the draft automatically when updates bring values back to server state", () => {
            const {store, draftState} = makeDraftState({"note-1": serverNote})

            // Change the title
            store.set(draftState.updateAtom, "note-1", {title: "Changed"})
            expect(store.get(draftState.isDirtyAtomFamily("note-1"))).toBe(true)

            // Revert the title back to original
            store.set(draftState.updateAtom, "note-1", {title: "Hello"})

            // Draft should be cleared — we're back to the server state
            expect(store.get(draftState.isDirtyAtomFamily("note-1"))).toBe(false)
            expect(store.get(draftState.hasDraftAtomFamily("note-1"))).toBe(false)
        })
    })

    // ── Discard draft ─────────────────────────────────────────────────────────

    describe("discarding a draft", () => {
        it("clears the draft and restores server state", () => {
            const {store, draftState} = makeDraftState({"note-1": serverNote})

            store.set(draftState.updateAtom, "note-1", {title: "Pending change"})
            store.set(draftState.discardDraftAtom, "note-1")

            expect(store.get(draftState.hasDraftAtomFamily("note-1"))).toBe(false)
            expect(store.get(draftState.isDirtyAtomFamily("note-1"))).toBe(false)
            expect(store.get(draftState.withDraftAtomFamily("note-1"))).toEqual(serverNote)
        })

        it("discard is a no-op when there is no draft", () => {
            const {store, draftState} = makeDraftState({"note-1": serverNote})

            store.set(draftState.discardDraftAtom, "note-1")

            expect(store.get(draftState.hasDraftAtomFamily("note-1"))).toBe(false)
            expect(store.get(draftState.withDraftAtomFamily("note-1"))).toEqual(serverNote)
        })
    })

    // ── Update with no entity ─────────────────────────────────────────────────

    describe("update when entity is null", () => {
        it("does nothing when the entity does not exist in the store", () => {
            const {store, draftState} = makeDraftState({})

            // Should not throw
            store.set(draftState.updateAtom, "ghost", {title: "Ghost"})

            expect(store.get(draftState.hasDraftAtomFamily("ghost"))).toBe(false)
        })
    })

    // ── excludeFields ─────────────────────────────────────────────────────────

    describe("excludeFields", () => {
        it("does not count excluded fields when checking isDirty", () => {
            const {entityAtomFamily} = makeEntityAtomFamily({"note-1": serverNote})
            const store = createStore()

            const draftState = createEntityDraftState<Note>({
                entityAtomFamily,
                getDraftableData: (note) => note,
                mergeDraft: (note, draft) => ({...note, ...draft}),
                excludeFields: new Set(["id"]),
            })

            // Update only the excluded 'id' field
            store.set(draftState.updateAtom, "note-1", {id: "note-999"})

            // Should not be considered dirty since 'id' is excluded
            expect(store.get(draftState.isDirtyAtomFamily("note-1"))).toBe(false)
        })

        it("still detects dirty when a non-excluded field changes", () => {
            const {entityAtomFamily} = makeEntityAtomFamily({"note-1": serverNote})
            const store = createStore()

            const draftState = createEntityDraftState<Note>({
                entityAtomFamily,
                getDraftableData: (note) => note,
                mergeDraft: (note, draft) => ({...note, ...draft}),
                excludeFields: new Set(["id"]),
            })

            store.set(draftState.updateAtom, "note-1", {title: "Changed title"})

            expect(store.get(draftState.isDirtyAtomFamily("note-1"))).toBe(true)
        })
    })

    // ── Custom isDirty ────────────────────────────────────────────────────────

    describe("custom isDirty function", () => {
        it("uses the provided isDirty function instead of the default", () => {
            const {entityAtomFamily} = makeEntityAtomFamily({"note-1": serverNote})
            const store = createStore()

            // Always reports not dirty — ignores all changes
            const draftState = createEntityDraftState<Note>({
                entityAtomFamily,
                getDraftableData: (note) => note,
                mergeDraft: (note, draft) => ({...note, ...draft}),
                isDirty: () => false,
            })

            store.set(draftState.updateAtom, "note-1", {title: "Anything"})

            // Custom isDirty says "not dirty", so draft should have been cleared
            expect(store.get(draftState.isDirtyAtomFamily("note-1"))).toBe(false)
        })
    })

    // ── Partial field update ──────────────────────────────────────────────────

    describe("partial field update", () => {
        it("only changes the specified fields, leaving others intact", () => {
            const {store, draftState} = makeDraftState({"note-1": serverNote})

            store.set(draftState.updateAtom, "note-1", {body: "New body"})

            const merged = store.get(draftState.withDraftAtomFamily("note-1"))
            expect(merged?.title).toBe("Hello")
            expect(merged?.body).toBe("New body")
            expect(merged?.id).toBe("note-1")
        })

        it("accumulates updates across multiple calls", () => {
            const {store, draftState} = makeDraftState({"note-1": serverNote})

            store.set(draftState.updateAtom, "note-1", {title: "First change"})
            store.set(draftState.updateAtom, "note-1", {body: "Second change"})

            const merged = store.get(draftState.withDraftAtomFamily("note-1"))
            expect(merged?.title).toBe("First change")
            expect(merged?.body).toBe("Second change")
        })
    })
})
