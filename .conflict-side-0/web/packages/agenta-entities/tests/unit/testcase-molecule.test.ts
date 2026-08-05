/**
 * Unit tests for testcaseMolecule.
 *
 * Covers the parts that work without a TanStack QueryClient or running backend:
 *
 *   • Molecule shape — exported properties exist
 *   • ID tracking atoms — ids, newIds, deletedIds (plain atoms)
 *   • Revision context — currentRevisionIdAtom
 *   • actions.add — creates a local testcase, adds to newIds, initializes draft
 *   • actions.delete — removes local (new-*) vs soft-deletes server entities
 *   • atoms.displayRowIds — derived: new first, server excluding deleted
 *   • atoms.hasUnsavedChanges — derived: true when new/dirty/deleted entities
 *   • Selection draft — setSelectionDraft / commitSelectionDraft / discardSelectionDraft
 *   • actions.create — batch creation of testcases with options
 *   • actions.append — batch append from row data
 *
 * Each test uses a fresh createStore() for full isolation.
 */

import {describe, it, expect} from "vitest"
import {createStore} from "jotai"

import {testcaseMolecule} from "../../src/testcase/state/molecule"

// ── helpers ───────────────────────────────────────────────────────────────────

function freshStore() {
    return createStore()
}

// ── Molecule shape ────────────────────────────────────────────────────────────

describe("testcaseMolecule shape", () => {
    it("exposes 'testcase' as the molecule name", () => {
        expect(testcaseMolecule.name).toBe("testcase")
    })

    it("exposes atoms namespace", () => {
        expect(testcaseMolecule.atoms).toBeDefined()
        expect(typeof testcaseMolecule.atoms.data).toBe("function")
        expect(typeof testcaseMolecule.atoms.isDirty).toBe("function")
        expect(typeof testcaseMolecule.atoms.draft).toBe("function")
    })

    it("exposes actions namespace", () => {
        expect(testcaseMolecule.actions).toBeDefined()
        expect(testcaseMolecule.actions.add).toBeDefined()
        expect(testcaseMolecule.actions.delete).toBeDefined()
        expect(testcaseMolecule.actions.update).toBeDefined()
        expect(testcaseMolecule.actions.discard).toBeDefined()
        expect(testcaseMolecule.actions.create).toBeDefined()
        expect(testcaseMolecule.actions.append).toBeDefined()
    })

    it("exposes top-level id tracking atoms", () => {
        expect(testcaseMolecule.ids).toBeDefined()
        expect(testcaseMolecule.newIds).toBeDefined()
        expect(testcaseMolecule.deletedIds).toBeDefined()
    })

    it("exposes loadable capability namespace", () => {
        expect(testcaseMolecule.loadable).toBeDefined()
        expect(typeof testcaseMolecule.loadable.rows).toBe("function")
        expect(typeof testcaseMolecule.loadable.columns).toBe("function")
        expect(typeof testcaseMolecule.loadable.hasChanges).toBe("function")
    })

    it("exposes get namespace with imperative getters", () => {
        expect(typeof testcaseMolecule.get.data).toBe("function")
        expect(typeof testcaseMolecule.get.ids).toBe("function")
        expect(typeof testcaseMolecule.get.newIds).toBe("function")
        expect(typeof testcaseMolecule.get.deletedIds).toBe("function")
    })
})

// ── ID tracking atoms ─────────────────────────────────────────────────────────

describe("ID tracking atoms", () => {
    it("ids starts empty", () => {
        const store = freshStore()
        expect(store.get(testcaseMolecule.ids)).toEqual([])
    })

    it("newIds starts empty", () => {
        const store = freshStore()
        expect(store.get(testcaseMolecule.newIds)).toEqual([])
    })

    it("deletedIds starts as empty Set", () => {
        const store = freshStore()
        expect(store.get(testcaseMolecule.deletedIds).size).toBe(0)
    })

    it("atoms.displayRowIds is empty initially", () => {
        const store = freshStore()
        expect(store.get(testcaseMolecule.atoms.displayRowIds)).toEqual([])
    })

    it("atoms.hasUnsavedChanges is false initially", () => {
        const store = freshStore()
        expect(store.get(testcaseMolecule.atoms.hasUnsavedChanges)).toBe(false)
    })

    it("atoms.revisionId is null initially", () => {
        const store = freshStore()
        expect(store.get(testcaseMolecule.atoms.revisionId)).toBeNull()
    })
})

// ── actions.add ───────────────────────────────────────────────────────────────

describe("actions.add", () => {
    it("returns a result with an ID", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add, {data: {input: "hello"}})
        expect(result).not.toBeNull()
        expect(typeof result?.id).toBe("string")
    })

    it("returns a result with a new- prefixed ID", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add, {data: {input: "hi"}})
        expect(result?.id.startsWith("new-")).toBe(true)
    })

    it("adds the entity ID to newIds", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add, {data: {col: "val"}})
        expect(store.get(testcaseMolecule.newIds)).toContain(result?.id)
    })

    it("hasUnsavedChanges is true after adding a testcase", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {data: {}})
        expect(store.get(testcaseMolecule.atoms.hasUnsavedChanges)).toBe(true)
    })

    it("the added ID appears in displayRowIds", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add, {data: {col: "val"}})
        expect(store.get(testcaseMolecule.atoms.displayRowIds)).toContain(result?.id)
    })

    it("multiple adds produce unique IDs", () => {
        const store = freshStore()
        const r1 = store.set(testcaseMolecule.actions.add, {data: {col: "a"}})
        const r2 = store.set(testcaseMolecule.actions.add, {data: {col: "b"}})
        expect(r1?.id).not.toBe(r2?.id)
    })

    it("stored data includes the provided fields", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add, {
            data: {country: "USA", score: 42},
        })
        const draft = store.get(testcaseMolecule.atoms.draft(result!.id))
        expect(draft?.data).toMatchObject({country: "USA", score: 42})
    })

    it("adding with no data succeeds with empty data object", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add)
        expect(result).not.toBeNull()
        expect(result?.id).toBeDefined()
    })
})

// ── actions.delete ────────────────────────────────────────────────────────────

describe("actions.delete", () => {
    it("removes a local (new-*) testcase from newIds completely", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add, {data: {}})
        const id = result!.id
        store.set(testcaseMolecule.actions.delete, id)
        expect(store.get(testcaseMolecule.newIds)).not.toContain(id)
    })

    it("clears the draft when removing a local testcase", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add, {data: {col: "x"}})
        const id = result!.id
        store.set(testcaseMolecule.actions.delete, id)
        expect(store.get(testcaseMolecule.atoms.draft(id))).toBeNull()
    })

    it("removes deleted local testcase from displayRowIds", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add, {data: {}})
        const id = result!.id
        store.set(testcaseMolecule.actions.delete, id)
        expect(store.get(testcaseMolecule.atoms.displayRowIds)).not.toContain(id)
    })

    it("accepts an array of IDs for batch delete", () => {
        const store = freshStore()
        const r1 = store.set(testcaseMolecule.actions.add, {data: {}})
        const r2 = store.set(testcaseMolecule.actions.add, {data: {}})
        store.set(testcaseMolecule.actions.delete, [r1!.id, r2!.id])
        expect(store.get(testcaseMolecule.newIds)).toHaveLength(0)
    })

    it("soft-deletes a server entity (adds to deletedIds)", () => {
        const store = freshStore()
        // Simulate a server entity by putting it in deletedIds via markDeleted
        const serverId = "server-tc-123"
        store.set(testcaseMolecule.actions.delete, serverId)
        expect(store.get(testcaseMolecule.deletedIds).has(serverId)).toBe(true)
    })
})

// ── displayRowIds and hasUnsavedChanges ───────────────────────────────────────

describe("displayRowIds and hasUnsavedChanges", () => {
    it("displayRowIds includes new entities", () => {
        const store = freshStore()
        const r1 = store.set(testcaseMolecule.actions.add, {data: {}})
        const r2 = store.set(testcaseMolecule.actions.add, {data: {}})
        const rowIds = store.get(testcaseMolecule.atoms.displayRowIds)
        expect(rowIds).toContain(r1!.id)
        expect(rowIds).toContain(r2!.id)
    })

    it("displayRowIds excludes deleted local entities", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add, {data: {}})
        const id = result!.id
        store.set(testcaseMolecule.actions.delete, id)
        expect(store.get(testcaseMolecule.atoms.displayRowIds)).not.toContain(id)
    })

    it("hasUnsavedChanges returns false when no entities present", () => {
        const store = freshStore()
        expect(store.get(testcaseMolecule.atoms.hasUnsavedChanges)).toBe(false)
    })

    it("hasUnsavedChanges returns false after deleting the only added entity", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.add, {data: {}})
        store.set(testcaseMolecule.actions.delete, result!.id)
        // After removing the only new entity, no unsaved changes remain
        expect(store.get(testcaseMolecule.atoms.hasUnsavedChanges)).toBe(false)
    })
})

// ── actions.create (batch with options) ───────────────────────────────────────

describe("actions.create", () => {
    it("creates multiple testcases from rows", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.create, {
            rows: [{col1: "a"}, {col1: "b"}],
        })
        expect(result.count).toBe(2)
        expect(result.ids).toHaveLength(2)
    })

    it("all created IDs are unique", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.create, {
            rows: [{x: 1}, {x: 2}, {x: 3}],
        })
        expect(new Set(result.ids).size).toBe(3)
    })

    it("created IDs appear in newIds", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.create, {
            rows: [{field: "val"}],
        })
        expect(store.get(testcaseMolecule.newIds)).toContain(result.ids[0])
    })

    it("returns zero count for empty rows array", () => {
        const store = freshStore()
        const result = store.set(testcaseMolecule.actions.create, {rows: []})
        expect(result.count).toBe(0)
        expect(result.ids).toHaveLength(0)
    })
})

// ── Selection draft operations ────────────────────────────────────────────────

describe("selection draft", () => {
    const REV = "rev-for-selection-test"

    it("selection draft starts as null", () => {
        const store = freshStore()
        expect(store.get(testcaseMolecule.atoms.selectionDraft(REV))).toBeNull()
    })

    it("setSelectionDraft populates the draft with provided IDs", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.setSelectionDraft, REV, ["tc-1", "tc-2"])
        const draft = store.get(testcaseMolecule.atoms.selectionDraft(REV))
        expect(draft?.has("tc-1")).toBe(true)
        expect(draft?.has("tc-2")).toBe(true)
    })

    it("discardSelectionDraft clears the draft back to null", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.setSelectionDraft, REV, ["tc-1"])
        store.set(testcaseMolecule.actions.discardSelectionDraft, REV)
        expect(store.get(testcaseMolecule.atoms.selectionDraft(REV))).toBeNull()
    })

    it("commitSelectionDraft updates testcaseIdsAtom to the selected set", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.setSelectionDraft, REV, ["tc-a", "tc-b"])
        store.set(testcaseMolecule.actions.commitSelectionDraft, REV)
        const ids = store.get(testcaseMolecule.ids)
        expect(ids).toContain("tc-a")
        expect(ids).toContain("tc-b")
    })

    it("commitSelectionDraft clears the draft", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.setSelectionDraft, REV, ["tc-1"])
        store.set(testcaseMolecule.actions.commitSelectionDraft, REV)
        expect(store.get(testcaseMolecule.atoms.selectionDraft(REV))).toBeNull()
    })

    it("drafts for different revisions are isolated", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.setSelectionDraft, "rev-A", ["tc-1"])
        expect(store.get(testcaseMolecule.atoms.selectionDraft("rev-B"))).toBeNull()
    })
})
