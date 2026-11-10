/**
 * The testcase data controller in server mode.
 *
 * The paginated store is replaced by a state atom that lists server rows, then the rows added
 * locally, minus the rows marked deleted. That is the shape the real store returns, so the test
 * checks what the controller does with it: new rows show only for an edit session.
 */
import {atom, createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

const stateAtom = vi.hoisted(() => ({current: null as unknown}))

vi.mock("../../src/testcase/state/paginatedStore", async (importOriginal) => {
    const original =
        await importOriginal<typeof import("../../src/testcase/state/paginatedStore")>()
    const {newEntityIdsAtom, deletedEntityIdsAtom} = await import("../../src/testcase/state/store")
    const state = atom((get) => {
        const deleted = get(deletedEntityIdsAtom)
        const server = [
            {id: "tc-1", key: "tc-1"},
            {id: "tc-2", key: "tc-2"},
        ]
        const local = get(newEntityIdsAtom).map((id) => ({id, key: id, __isNew: true}))
        const skeleton = [{id: "", key: "", __isSkeleton: true}]
        return {
            rows: [...local, ...server, ...skeleton].filter((row) => !deleted.has(row.id)),
            isFetching: false,
        }
    })
    stateAtom.current = state
    return {
        ...original,
        testcasePaginatedStore: {
            ...original.testcasePaginatedStore,
            selectors: {...original.testcasePaginatedStore.selectors, state: () => state},
        },
    }
})

const {testcaseDataController} = await import("../../src/testcase/state/dataController")
const {testcaseMolecule} = await import("../../src/testcase/state/molecule")

const readRows = (store: ReturnType<typeof createStore>, includeNewRows?: boolean) =>
    store
        .get(
            testcaseDataController.selectors.rows({
                scopeId: `scope-${String(includeNewRows)}`,
                revisionId: "rev-1",
                includeNewRows,
            }),
        )
        .map((row) => row.id)

describe("testcaseDataController rows in server mode", () => {
    it("shows server rows only without an edit session", () => {
        const store = createStore()
        store.set(testcaseMolecule.actions.add, {data: {question: "Hi"}})
        expect(readRows(store)).toEqual(["tc-1", "tc-2"])
    })

    it("shows a new local row for an edit session", () => {
        const store = createStore()
        const added = store.set(testcaseMolecule.actions.add, {data: {question: "Hi"}})
        const ids = readRows(store, true)
        expect(ids).toEqual([added?.id, "tc-1", "tc-2"])
        expect(added?.id.startsWith("new-")).toBe(true)
    })

    it("hides a row marked deleted for an edit session", () => {
        const store = createStore()
        store.set(testcaseMolecule.actions.delete, "tc-1")
        expect(readRows(store, true)).toEqual(["tc-2"])
    })
})

describe("testcaseDataController search", () => {
    it("narrows the rows and keeps every column", () => {
        const store = createStore()
        store.set(testcaseMolecule.actions.add, {data: {country: "Peru", capital: "Lima"}})
        store.set(testcaseMolecule.actions.add, {data: {country: "Chad", note: "inland"}})
        const config = {scopeId: "scope-search", revisionId: "rev-1", includeNewRows: true}
        const searched = {...config, searchTerm: "peru"}

        expect(store.get(testcaseDataController.selectors.rows(searched))).toHaveLength(1)
        expect(
            store.get(testcaseDataController.selectors.columns(searched)).map((c) => c.key),
        ).toEqual(["country", "capital", "note"])
    })

    it("shows the columns of a matching row past the first 20", () => {
        const store = createStore()
        for (let index = 0; index < 20; index++) {
            store.set(testcaseMolecule.actions.add, {data: {country: `Country ${index}`}})
        }
        store.set(testcaseMolecule.actions.add, {data: {country: "Peru", note: "late"}})
        const config = {scopeId: "scope-late", revisionId: "rev-1", includeNewRows: true}

        const keys = (searchTerm?: string) =>
            store
                .get(testcaseDataController.selectors.columns({...config, searchTerm}))
                .map((column) => column.key)
        expect(keys("peru")).toEqual(["country", "note"])
    })

    it("keeps a user column named id or data", () => {
        const store = createStore()
        store.set(testcaseMolecule.actions.add, {data: {id: "user-id", data: null, question: "Q"}})
        const config = {scopeId: "scope-id-data", revisionId: "rev-1", includeNewRows: true}
        expect(
            store.get(testcaseDataController.selectors.columns(config)).map((c) => c.key),
        ).toEqual(["id", "data", "question"])
    })
})
