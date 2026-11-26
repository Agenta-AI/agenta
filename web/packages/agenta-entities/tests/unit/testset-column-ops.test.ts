/**
 * Staged column edits: the pending operations must say what the server will do with the
 * saved rows, because the commit sends them as one delta and the server reads removals and
 * renames on the saved names in one pass.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    addColumnReducer,
    applyColumnOps,
    pendingColumnOpsAtomFamily,
    removeColumnReducer,
    renameColumnReducer,
} from "../../src/testset/state/revisionTableState"

const REVISION = "rev-ops"

const session = () => {
    const store = createStore()
    return {
        add: (columnKey: string) => store.set(addColumnReducer, {revisionId: REVISION, columnKey}),
        remove: (columnKey: string) =>
            store.set(removeColumnReducer, {revisionId: REVISION, columnKey}),
        rename: (oldKey: string, newKey: string) =>
            store.set(renameColumnReducer, {revisionId: REVISION, oldKey, newKey}),
        ops: () => store.get(pendingColumnOpsAtomFamily(REVISION)),
    }
}

describe("applyColumnOps", () => {
    it("reads removals and renames on the saved names, then adds missing columns empty", () => {
        const row = {a: 1, b: 2, c: 3}
        expect(
            applyColumnOps(row, {remove: ["a"], rename: [{oldKey: "b", newKey: "a"}], add: ["d"]}),
        ).toEqual({
            a: 2,
            c: 3,
            d: "",
        })
    })

    it("keeps the key order and returns the same object when nothing changes", () => {
        const row = {a: 1, b: 2}
        expect(
            Object.keys(
                applyColumnOps(row, {remove: [], rename: [{oldKey: "a", newKey: "z"}], add: []}),
            ),
        ).toEqual(["z", "b"])
        expect(applyColumnOps(row, {remove: [], rename: [], add: []})).toBe(row)
    })
})

describe("column reducers", () => {
    it("a renamed column that is deleted is removed under its saved name", () => {
        const columns = session()
        columns.rename("answer", "reply")
        columns.remove("reply")
        expect(columns.ops()).toEqual({add: [], remove: ["answer"], rename: []})
    })

    it("a saved column deleted and added again stays removed and is added empty", () => {
        const columns = session()
        columns.remove("answer")
        columns.add("answer")
        expect(columns.ops()).toEqual({add: ["answer"], remove: ["answer"], rename: []})
        expect(applyColumnOps({answer: "old", q: "x"}, columns.ops())).toEqual({q: "x", answer: ""})
    })

    it("two renames of one column keep one rename, and a rename back drops it", () => {
        const columns = session()
        columns.rename("a", "b")
        columns.rename("b", "c")
        expect(columns.ops().rename).toEqual([{oldKey: "a", newKey: "c"}])
        columns.rename("c", "a")
        expect(columns.ops().rename).toEqual([])
    })

    it("an added column changes its name in the add list and leaves it when deleted", () => {
        const columns = session()
        columns.add("x")
        columns.rename("x", "y")
        expect(columns.ops()).toEqual({add: ["y"], remove: [], rename: []})
        columns.remove("y")
        expect(columns.ops()).toEqual({add: [], remove: [], rename: []})
    })
})
