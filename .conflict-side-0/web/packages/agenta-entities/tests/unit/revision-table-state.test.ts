/**
 * Unit tests for revision table state atoms and reducers.
 *
 * The revision table state manages pending column and row operations for a
 * testset revision before they are committed to the server. This module is
 * pure Jotai (no TanStack Query, no network) — all reducers and atoms can be
 * exercised with a plain createStore().
 *
 * Coverage:
 *   • pendingColumnOpsAtomFamily — initial state, isolation per revision
 *   • pendingRowOpsAtomFamily    — initial state, isolation per revision
 *   • addColumnReducer           — adds to add[], de-duplication
 *   • removeColumnReducer        — removes pending adds; marks server cols for deletion
 *   • renameColumnReducer        — renames in add[]; appends to rename[]
 *   • addRowReducer              — adds to add[], returns the row ID
 *   • removeRowReducer           — cancels pending adds; marks server rows for deletion
 *   • removeRowsReducer          — batch remove
 *   • clearPendingOpsReducer     — resets all pending state
 *   • hasPendingChangesAtomFamily— false initially, true after any op
 */

import {describe, it, expect} from "vitest"
import {createStore} from "jotai"

import {
    pendingColumnOpsAtomFamily,
    pendingRowOpsAtomFamily,
    hasPendingChangesAtomFamily,
    addColumnReducer,
    removeColumnReducer,
    renameColumnReducer,
    addRowReducer,
    removeRowReducer,
    removeRowsReducer,
    clearPendingOpsReducer,
} from "../../src/testset/state/revisionTableState"

// ── helpers ───────────────────────────────────────────────────────────────────

function freshStore() {
    return createStore()
}

const REV = "rev-1"

// ── Initial state ─────────────────────────────────────────────────────────────

describe("initial state", () => {
    it("pendingColumnOps starts with empty add/remove/rename", () => {
        const store = freshStore()
        const ops = store.get(pendingColumnOpsAtomFamily(REV))
        expect(ops.add).toEqual([])
        expect(ops.remove).toEqual([])
        expect(ops.rename).toEqual([])
    })

    it("pendingRowOps starts with empty add/remove", () => {
        const store = freshStore()
        const ops = store.get(pendingRowOpsAtomFamily(REV))
        expect(ops.add).toEqual([])
        expect(ops.remove).toEqual([])
    })

    it("hasPendingChanges is false initially", () => {
        const store = freshStore()
        expect(store.get(hasPendingChangesAtomFamily(REV))).toBe(false)
    })

    it("different revision IDs are isolated", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: "rev-A", columnKey: "col"})
        const opsB = store.get(pendingColumnOpsAtomFamily("rev-B"))
        expect(opsB.add).toHaveLength(0)
    })
})

// ── addColumnReducer ──────────────────────────────────────────────────────────

describe("addColumnReducer", () => {
    it("adds a column key to the add list", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: REV, columnKey: "score"})
        expect(store.get(pendingColumnOpsAtomFamily(REV)).add).toContain("score")
    })

    it("hasPendingChanges becomes true after adding a column", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: REV, columnKey: "score"})
        expect(store.get(hasPendingChangesAtomFamily(REV))).toBe(true)
    })

    it("does not add a duplicate key", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: REV, columnKey: "score"})
        store.set(addColumnReducer, {revisionId: REV, columnKey: "score"})
        expect(store.get(pendingColumnOpsAtomFamily(REV)).add).toHaveLength(1)
    })

    it("un-removes a previously removed column instead of adding", () => {
        const store = freshStore()
        // Simulate a server column "notes" that was pending removal
        store.set(pendingColumnOpsAtomFamily(REV), {
            add: [],
            remove: ["notes"],
            rename: [],
        })
        store.set(addColumnReducer, {revisionId: REV, columnKey: "notes"})
        const ops = store.get(pendingColumnOpsAtomFamily(REV))
        expect(ops.remove).not.toContain("notes")
        expect(ops.add).not.toContain("notes")
    })

    it("accumulates multiple column adds", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: REV, columnKey: "alpha"})
        store.set(addColumnReducer, {revisionId: REV, columnKey: "beta"})
        const ops = store.get(pendingColumnOpsAtomFamily(REV))
        expect(ops.add).toEqual(expect.arrayContaining(["alpha", "beta"]))
    })
})

// ── removeColumnReducer ───────────────────────────────────────────────────────

describe("removeColumnReducer", () => {
    it("removes a pending-add column from the add list (no remove entry)", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: REV, columnKey: "temp"})
        store.set(removeColumnReducer, {revisionId: REV, columnKey: "temp"})
        const ops = store.get(pendingColumnOpsAtomFamily(REV))
        expect(ops.add).not.toContain("temp")
        expect(ops.remove).not.toContain("temp")
    })

    it("marks a server (non-pending) column for removal", () => {
        const store = freshStore()
        store.set(removeColumnReducer, {revisionId: REV, columnKey: "country"})
        expect(store.get(pendingColumnOpsAtomFamily(REV)).remove).toContain("country")
    })

    it("does not duplicate a column in the remove list", () => {
        const store = freshStore()
        store.set(removeColumnReducer, {revisionId: REV, columnKey: "country"})
        store.set(removeColumnReducer, {revisionId: REV, columnKey: "country"})
        expect(store.get(pendingColumnOpsAtomFamily(REV)).remove).toHaveLength(1)
    })
})

// ── renameColumnReducer ───────────────────────────────────────────────────────

describe("renameColumnReducer", () => {
    it("renames a pending-add column in the add list", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: REV, columnKey: "old_name"})
        store.set(renameColumnReducer, {revisionId: REV, oldKey: "old_name", newKey: "new_name"})
        const ops = store.get(pendingColumnOpsAtomFamily(REV))
        expect(ops.add).toContain("new_name")
        expect(ops.add).not.toContain("old_name")
        expect(ops.rename).toHaveLength(0) // rename goes to add[], not rename[]
    })

    it("appends a rename entry for a server column", () => {
        const store = freshStore()
        store.set(renameColumnReducer, {revisionId: REV, oldKey: "score", newKey: "rating"})
        const ops = store.get(pendingColumnOpsAtomFamily(REV))
        expect(ops.rename).toContainEqual({oldKey: "score", newKey: "rating"})
    })

    it("updates an existing rename entry instead of duplicating", () => {
        const store = freshStore()
        store.set(renameColumnReducer, {revisionId: REV, oldKey: "score", newKey: "rating"})
        store.set(renameColumnReducer, {revisionId: REV, oldKey: "score", newKey: "final_score"})
        const ops = store.get(pendingColumnOpsAtomFamily(REV))
        expect(ops.rename).toHaveLength(1)
        expect(ops.rename[0]).toEqual({oldKey: "score", newKey: "final_score"})
    })
})

// ── addRowReducer ─────────────────────────────────────────────────────────────

describe("addRowReducer", () => {
    it("adds a provided row ID to pending adds", () => {
        const store = freshStore()
        store.set(addRowReducer, {revisionId: REV, rowId: "local-row-1"})
        expect(store.get(pendingRowOpsAtomFamily(REV)).add).toContain("local-row-1")
    })

    it("returns the row ID that was added", () => {
        const store = freshStore()
        const id = store.set(addRowReducer, {revisionId: REV, rowId: "local-row-abc"})
        expect(id).toBe("local-row-abc")
    })

    it("generates a new- prefixed ID when no rowId is provided", () => {
        const store = freshStore()
        const id = store.set(addRowReducer, {revisionId: REV})
        expect(id.startsWith("new-")).toBe(true)
    })

    it("hasPendingChanges is true after adding a row", () => {
        const store = freshStore()
        store.set(addRowReducer, {revisionId: REV, rowId: "r1"})
        expect(store.get(hasPendingChangesAtomFamily(REV))).toBe(true)
    })

    it("does not duplicate an already-pending add", () => {
        const store = freshStore()
        store.set(addRowReducer, {revisionId: REV, rowId: "r1"})
        store.set(addRowReducer, {revisionId: REV, rowId: "r1"})
        expect(store.get(pendingRowOpsAtomFamily(REV)).add).toHaveLength(1)
    })
})

// ── removeRowReducer ──────────────────────────────────────────────────────────

describe("removeRowReducer", () => {
    it("cancels a pending-add row (removes from add[], no remove entry)", () => {
        const store = freshStore()
        store.set(addRowReducer, {revisionId: REV, rowId: "local-r1"})
        store.set(removeRowReducer, {revisionId: REV, rowId: "local-r1"})
        const ops = store.get(pendingRowOpsAtomFamily(REV))
        expect(ops.add).not.toContain("local-r1")
        expect(ops.remove).not.toContain("local-r1")
    })

    it("marks a server row for deletion", () => {
        const store = freshStore()
        store.set(removeRowReducer, {revisionId: REV, rowId: "server-row-1"})
        expect(store.get(pendingRowOpsAtomFamily(REV)).remove).toContain("server-row-1")
    })

    it("does not duplicate a server row in remove list", () => {
        const store = freshStore()
        store.set(removeRowReducer, {revisionId: REV, rowId: "server-row-1"})
        store.set(removeRowReducer, {revisionId: REV, rowId: "server-row-1"})
        expect(store.get(pendingRowOpsAtomFamily(REV)).remove).toHaveLength(1)
    })
})

// ── removeRowsReducer ─────────────────────────────────────────────────────────

describe("removeRowsReducer", () => {
    it("removes multiple rows at once", () => {
        const store = freshStore()
        store.set(removeRowsReducer, {revisionId: REV, rowIds: ["r1", "r2", "r3"]})
        const ops = store.get(pendingRowOpsAtomFamily(REV))
        expect(ops.remove).toEqual(expect.arrayContaining(["r1", "r2", "r3"]))
    })

    it("cancels pending-add rows without adding to remove list", () => {
        const store = freshStore()
        store.set(addRowReducer, {revisionId: REV, rowId: "local-1"})
        store.set(addRowReducer, {revisionId: REV, rowId: "local-2"})
        store.set(removeRowsReducer, {revisionId: REV, rowIds: ["local-1", "server-1"]})
        const ops = store.get(pendingRowOpsAtomFamily(REV))
        expect(ops.add).not.toContain("local-1")
        expect(ops.add).toContain("local-2")
        expect(ops.remove).toContain("server-1")
        expect(ops.remove).not.toContain("local-1")
    })
})

// ── clearPendingOpsReducer ────────────────────────────────────────────────────

describe("clearPendingOpsReducer", () => {
    it("resets all column ops to empty", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: REV, columnKey: "col"})
        store.set(removeColumnReducer, {revisionId: REV, columnKey: "other"})
        store.set(clearPendingOpsReducer, REV)
        const ops = store.get(pendingColumnOpsAtomFamily(REV))
        expect(ops.add).toEqual([])
        expect(ops.remove).toEqual([])
        expect(ops.rename).toEqual([])
    })

    it("resets all row ops to empty", () => {
        const store = freshStore()
        store.set(addRowReducer, {revisionId: REV, rowId: "r1"})
        store.set(removeRowReducer, {revisionId: REV, rowId: "server-r1"})
        store.set(clearPendingOpsReducer, REV)
        const ops = store.get(pendingRowOpsAtomFamily(REV))
        expect(ops.add).toEqual([])
        expect(ops.remove).toEqual([])
    })

    it("hasPendingChanges is false after clearing", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: REV, columnKey: "col"})
        store.set(clearPendingOpsReducer, REV)
        expect(store.get(hasPendingChangesAtomFamily(REV))).toBe(false)
    })

    it("clear for one revision does not affect another", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: "rev-A", columnKey: "col"})
        store.set(addColumnReducer, {revisionId: "rev-B", columnKey: "col"})
        store.set(clearPendingOpsReducer, "rev-A")
        expect(store.get(hasPendingChangesAtomFamily("rev-B"))).toBe(true)
    })
})

// ── hasPendingChangesAtomFamily ───────────────────────────────────────────────

describe("hasPendingChangesAtomFamily", () => {
    it("is false with no operations", () => {
        const store = freshStore()
        expect(store.get(hasPendingChangesAtomFamily(REV))).toBe(false)
    })

    it("is true with a pending column add", () => {
        const store = freshStore()
        store.set(addColumnReducer, {revisionId: REV, columnKey: "x"})
        expect(store.get(hasPendingChangesAtomFamily(REV))).toBe(true)
    })

    it("is true with a pending column remove", () => {
        const store = freshStore()
        store.set(removeColumnReducer, {revisionId: REV, columnKey: "x"})
        expect(store.get(hasPendingChangesAtomFamily(REV))).toBe(true)
    })

    it("is true with a pending column rename", () => {
        const store = freshStore()
        store.set(renameColumnReducer, {revisionId: REV, oldKey: "a", newKey: "b"})
        expect(store.get(hasPendingChangesAtomFamily(REV))).toBe(true)
    })

    it("is true with a pending row add", () => {
        const store = freshStore()
        store.set(addRowReducer, {revisionId: REV, rowId: "r1"})
        expect(store.get(hasPendingChangesAtomFamily(REV))).toBe(true)
    })

    it("is true with a pending row remove", () => {
        const store = freshStore()
        store.set(removeRowReducer, {revisionId: REV, rowId: "r1"})
        expect(store.get(hasPendingChangesAtomFamily(REV))).toBe(true)
    })
})
