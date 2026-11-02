/**
 * Header metadata and the save session of a Testset revision.
 *
 * The save reads column changes only from `revisionMolecule.tableReducers` (the revision
 * level pending operations). A screen must edit columns through those reducers, or the
 * column change is lost on commit.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const patchRevisionMock = vi.fn()
const fetchRevisionMock = vi.fn()

vi.mock("../../src/testset/api/api", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {...actual, fetchRevision: (...args: unknown[]) => fetchRevisionMock(...args)}
})
vi.mock("../../src/testset/api/mutations", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {...actual, patchRevision: (...args: unknown[]) => patchRevisionMock(...args)}
})

import {testcaseMolecule} from "../../src/testcase/state/molecule"
import {currentRevisionIdAtom} from "../../src/testcase/state/store"
import {
    clearChangesAtom,
    changesSummaryAtom,
    saveTestsetAtom,
    testsetRevisionHeaderAtomFamily,
} from "../../src/testset"
import {revisionMolecule} from "../../src/testset/state/revisionMolecule"

const PROJECT = "proj-1"
const REVISION = "rev-1"
const TESTSET = "ts-1"

const store = getDefaultStore()
let queryClient: QueryClient

beforeEach(() => {
    queryClient = new QueryClient()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, PROJECT)
    store.set(currentRevisionIdAtom, REVISION)
    store.set(clearChangesAtom)
    patchRevisionMock.mockReset()
    fetchRevisionMock.mockReset()
    fetchRevisionMock.mockResolvedValue({id: REVISION, name: "Testset name", testset_id: TESTSET})
    patchRevisionMock.mockResolvedValue({
        testset_revision: {id: "rev-2", version: 2, data: {testcases: [{id: "c1", data: {}}]}},
    })
})

describe("testsetRevisionHeaderAtomFamily", () => {
    it("Header metadata takes the name and description from the testset, not the revision", () => {
        queryClient.setQueryData(["revision", PROJECT, REVISION], {
            id: REVISION,
            testset_id: TESTSET,
            name: "Revision name",
            description: "Revision description",
            version: 3,
            message: "msg",
            author: "a1",
        })
        queryClient.setQueryData(["testset", PROJECT, TESTSET], {
            id: TESTSET,
            name: "Testset name",
            description: "Testset description",
            slug: "testset-slug",
        })

        const state = store.get(testsetRevisionHeaderAtomFamily(REVISION))
        expect(state.data?.testsetName).toBe("Testset name")
        expect(state.data?.description).toBe("Testset description")
        expect(state.data?.revisionVersion).toBe(3)
        expect(state.data?.commitMessage).toBe("msg")
        expect(state.data?.author).toBe("a1")
    })

    it("Header metadata includes the testset slug", () => {
        queryClient.setQueryData(["revision", PROJECT, REVISION], {
            id: REVISION,
            testset_id: TESTSET,
            version: 1,
        })
        queryClient.setQueryData(["testset", PROJECT, TESTSET], {
            id: TESTSET,
            name: "T",
            slug: "my-slug",
        })
        expect(store.get(testsetRevisionHeaderAtomFamily(REVISION)).data?.testsetSlug).toBe(
            "my-slug",
        )
    })

    it("Header metadata is pending while the testset loads", () => {
        queryClient.setQueryData(["revision", PROJECT, REVISION], {
            id: REVISION,
            testset_id: TESTSET,
            version: 1,
        })
        const state = store.get(testsetRevisionHeaderAtomFamily(REVISION))
        expect(state.data?.testsetName).toBe("")
        expect(state.isPending).toBe(true)
    })

    it("Header metadata is pending while the revision loads", () => {
        const state = store.get(testsetRevisionHeaderAtomFamily("rev-not-loaded"))
        expect(state.data).toBeNull()
        expect(state.isPending).toBe(true)
        expect(state.isError).toBe(false)
    })
})

describe("saveTestsetAtom", () => {
    const save = () =>
        store.set(saveTestsetAtom, {projectId: PROJECT, testsetId: TESTSET, revisionId: REVISION})

    it("A column renamed through the revision table reducers is sent as a column replace on commit", async () => {
        store.set(revisionMolecule.tableReducers.renameColumn, {
            revisionId: REVISION,
            oldKey: "question",
            newKey: "prompt",
        })

        const result = await save()

        expect(result.success).toBe(true)
        expect(patchRevisionMock).toHaveBeenCalledTimes(1)
        expect(patchRevisionMock.mock.calls[0][0].operations.columns).toEqual({
            replace: [["question", "prompt"]],
        })
    })

    it("An added row and a deleted row are sent as row add and row remove on commit", async () => {
        store.set(testcaseMolecule.actions.add, {data: {question: "q1"}})
        store.set(testcaseMolecule.actions.delete, "server-case-1")

        const result = await save()

        expect(result.success).toBe(true)
        const rows = patchRevisionMock.mock.calls[0][0].operations.rows
        expect(rows.add).toEqual([{data: {question: "q1"}}])
        expect(rows.remove).toEqual(["server-case-1"])
    })

    it("Clear changes drops drafts, new rows, deleted rows and column operations", () => {
        store.set(revisionMolecule.tableReducers.addColumn, {revisionId: REVISION, columnKey: "c"})
        store.set(testcaseMolecule.actions.add, {data: {c: "x"}})
        store.set(testcaseMolecule.actions.delete, "server-case-1")
        expect(store.get(changesSummaryAtom).hasChanges).toBe(true)

        store.set(clearChangesAtom)

        expect(store.get(changesSummaryAtom)).toMatchObject({
            newTestcases: 0,
            deletedTestcases: 0,
            addedColumns: 0,
            renamedColumns: 0,
            deletedColumns: 0,
            hasChanges: false,
        })
    })
})
