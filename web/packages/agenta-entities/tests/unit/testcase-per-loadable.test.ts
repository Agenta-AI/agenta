/**
 * Per-loadable testcase id scoping — Phase 3 of the testset-sync
 * flakiness refactor.
 *
 * Background. The legacy global atoms (`testcaseIdsAtom`, `newEntityIdsAtom`,
 * `deletedEntityIdsAtom`) lived in a single bucket, so any consumer's
 * connectToSource / disconnect / mutation would observably affect every
 * other consumer that happened to share the testcase store. The most
 * visible symptom — reported by Mahmoud — was a drawer keeping its
 * "connected" pill while its rows silently emptied because a sibling
 * surface had reset the shared bucket.
 *
 * These tests pin the new invariants:
 *
 *   1. Two loadables maintain INDEPENDENT id state. Writing to one
 *      doesn't touch the other.
 *   2. Each loadable has its own `displayRowIds` view (server minus
 *      deleted, then new).
 *   3. The legacy global view follows `currentLoadableIdForIdsAtom` — so
 *      unmigrated consumers see the "right" loadable in single-loadable
 *      scenarios.
 *   4. With no current loadable set, global writes are no-ops (they
 *      don't silently leak rows into a default bucket).
 *
 * Each test uses a fresh `createStore()` for full isolation. We exercise
 * the lowest-level setters directly (rather than going through the
 * loadable controller's `connectToSource`/`disconnect`) so the tests are
 * pinning the store contract independently of the controller's policy.
 */

import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {testcaseMolecule} from "../../src/testcase/state/molecule"
import {
    clearDeletedIdsForLoadableAtom,
    clearNewEntityIdsForLoadableAtom,
    currentLoadableIdForIdsAtom,
    deletedEntityIdsAtom,
    deletedEntityIdsByLoadableAtomFamily,
    markDeletedForLoadableAtom,
    newEntityIdsAtom,
    newEntityIdsByLoadableAtomFamily,
    resetTestcaseIdsForLoadableAtom,
    setTestcaseIdsForLoadableAtom,
    testcaseIdsAtom,
    testcaseIdsByLoadableAtomFamily,
    addNewEntityIdForLoadableAtom,
} from "../../src/testcase/state/store"

const LOADABLE_A = "testset:appRevision:app-A"
const LOADABLE_B = "testset:appRevision:app-B"

describe("per-loadable id scoping — invariant #1: cross-loadable isolation", () => {
    it("populating loadable A doesn't touch loadable B's server ids", () => {
        const store = createStore()
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_A, ["a1", "a2"])
        expect(store.get(testcaseIdsByLoadableAtomFamily(LOADABLE_A))).toEqual(["a1", "a2"])
        expect(store.get(testcaseIdsByLoadableAtomFamily(LOADABLE_B))).toEqual([])
    })

    it("resetting loadable A doesn't clear loadable B's server ids", () => {
        const store = createStore()
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_A, ["a1"])
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_B, ["b1", "b2"])

        store.set(resetTestcaseIdsForLoadableAtom, LOADABLE_A)

        expect(store.get(testcaseIdsByLoadableAtomFamily(LOADABLE_A))).toEqual([])
        // The cross-loadable pollution bug: pre-refactor, this would have
        // been wiped. Pin the new behavior — B's rows survive.
        expect(store.get(testcaseIdsByLoadableAtomFamily(LOADABLE_B))).toEqual(["b1", "b2"])
    })

    it("adding a new local entity to loadable A doesn't add it to loadable B", () => {
        const store = createStore()
        store.set(addNewEntityIdForLoadableAtom, LOADABLE_A, "new-a-1")
        expect(store.get(newEntityIdsByLoadableAtomFamily(LOADABLE_A))).toEqual(["new-a-1"])
        expect(store.get(newEntityIdsByLoadableAtomFamily(LOADABLE_B))).toEqual([])
    })

    it("marking deleted on loadable A doesn't affect loadable B's deleted set", () => {
        const store = createStore()
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_A, ["a1", "a2"])
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_B, ["b1"])

        store.set(markDeletedForLoadableAtom, LOADABLE_A, "a1")

        expect(store.get(deletedEntityIdsByLoadableAtomFamily(LOADABLE_A)).has("a1")).toBe(true)
        expect(store.get(deletedEntityIdsByLoadableAtomFamily(LOADABLE_B)).size).toBe(0)
    })
})

describe("per-loadable id scoping — invariant #2: independent displayRowIds", () => {
    it("each loadable's displayRowIds reflects only its own state", () => {
        const store = createStore()
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_A, ["a1", "a2"])
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_B, ["b1"])
        store.set(addNewEntityIdForLoadableAtom, LOADABLE_A, "new-a")

        expect(store.get(testcaseMolecule.atoms.displayRowIdsForLoadable(LOADABLE_A))).toEqual([
            "a1",
            "a2",
            "new-a",
        ])
        expect(store.get(testcaseMolecule.atoms.displayRowIdsForLoadable(LOADABLE_B))).toEqual([
            "b1",
        ])
    })

    it("deleting a row in loadable A doesn't filter it out of loadable B", () => {
        const store = createStore()
        // Both loadables happen to share an id (e.g., the same testset
        // revision's testcase populated into two different connections).
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_A, ["shared-1"])
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_B, ["shared-1"])

        store.set(markDeletedForLoadableAtom, LOADABLE_A, "shared-1")

        expect(store.get(testcaseMolecule.atoms.displayRowIdsForLoadable(LOADABLE_A))).toEqual([])
        // B's deleted set was never touched — its display still includes
        // the row.
        expect(store.get(testcaseMolecule.atoms.displayRowIdsForLoadable(LOADABLE_B))).toEqual([
            "shared-1",
        ])
    })
})

describe("per-loadable id scoping — invariant #3: legacy global view follows current loadable", () => {
    it("global testcaseIds view returns the current loadable's bucket", () => {
        const store = createStore()
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_A, ["a1"])
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_B, ["b1", "b2"])

        store.set(currentLoadableIdForIdsAtom, LOADABLE_A)
        expect(store.get(testcaseIdsAtom)).toEqual(["a1"])

        store.set(currentLoadableIdForIdsAtom, LOADABLE_B)
        expect(store.get(testcaseIdsAtom)).toEqual(["b1", "b2"])
    })

    it("global newIds and deletedIds also follow the current loadable", () => {
        const store = createStore()
        store.set(addNewEntityIdForLoadableAtom, LOADABLE_A, "new-a")
        store.set(addNewEntityIdForLoadableAtom, LOADABLE_B, "new-b")
        store.set(markDeletedForLoadableAtom, LOADABLE_A, "del-a")

        store.set(currentLoadableIdForIdsAtom, LOADABLE_A)
        expect(store.get(newEntityIdsAtom)).toEqual(["new-a"])
        expect(store.get(deletedEntityIdsAtom).has("del-a")).toBe(true)
        expect(store.get(deletedEntityIdsAtom).has("del-b")).toBe(false)

        store.set(currentLoadableIdForIdsAtom, LOADABLE_B)
        expect(store.get(newEntityIdsAtom)).toEqual(["new-b"])
        expect(store.get(deletedEntityIdsAtom).has("del-a")).toBe(false)
    })
})

describe("per-loadable id scoping — invariant #4: no-current-loadable safety", () => {
    it("global view returns empty arrays when no current loadable is set", () => {
        const store = createStore()
        store.set(setTestcaseIdsForLoadableAtom, LOADABLE_A, ["a1"])

        // No `currentLoadableIdForIdsAtom` set — global views should
        // return empty, not silently leak into a "default" bucket.
        expect(store.get(testcaseIdsAtom)).toEqual([])
        expect(store.get(newEntityIdsAtom)).toEqual([])
        expect(store.get(deletedEntityIdsAtom).size).toBe(0)
    })

    it("clear-for-loadable doesn't affect a different loadable's data", () => {
        const store = createStore()
        store.set(addNewEntityIdForLoadableAtom, LOADABLE_A, "new-a")
        store.set(markDeletedForLoadableAtom, LOADABLE_B, "del-b")

        store.set(clearNewEntityIdsForLoadableAtom, LOADABLE_A)
        store.set(clearDeletedIdsForLoadableAtom, LOADABLE_B)

        expect(store.get(newEntityIdsByLoadableAtomFamily(LOADABLE_A))).toEqual([])
        expect(store.get(deletedEntityIdsByLoadableAtomFamily(LOADABLE_B)).size).toBe(0)
        // Loadable A's deleted set and Loadable B's new ids were never
        // populated — they stay at the family default (empty).
        expect(store.get(deletedEntityIdsByLoadableAtomFamily(LOADABLE_A)).size).toBe(0)
        expect(store.get(newEntityIdsByLoadableAtomFamily(LOADABLE_B))).toEqual([])
    })
})
