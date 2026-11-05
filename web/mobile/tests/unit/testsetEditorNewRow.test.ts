// @vitest-environment jsdom
// A row added to a saved test set: the row drawer shows the row data, so the row needs a key for
// each column the test set already has.
import {createElement, act} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {emptyRowData, useTestsetEditor} from "@/features/testsets/detail/useTestsetEditor"

vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
vi.mock("@agenta/entities/testcase", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/entities/testcase")>()
    const {atom} = await import("jotai")
    // The columns the grid reads from the saved rows: two plain columns and one nested one.
    const columns = atom(() => [
        {key: "country", label: "country"},
        {key: "outputs", label: "outputs"},
        {key: "meta.source", label: "source", parentKey: "meta"},
    ])
    return {
        ...original,
        testcaseDataController: {
            ...original.testcaseDataController,
            selectors: {...original.testcaseDataController.selectors, columns: () => columns},
        },
    }
})
vi.mock("@agenta/entities/testset", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/entities/testset")>()
    const {atom} = await import("jotai")
    const header = atom({
        data: {testsetId: "set-1", testsetName: "Capitals", revisionVersion: 1},
        isPending: false,
        isError: false,
    })
    return {...original, testsetRevisionHeaderAtomFamily: () => header}
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const REVISION = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"

let latest: ReturnType<typeof useTestsetEditor> | null = null
function Probe() {
    latest = useTestsetEditor({projectId: "pr", routeId: REVISION, nameFromUrl: null})
    return null
}

describe("useTestsetEditor add row on a saved test set", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
        act(() => root.render(createElement(Provider, {store}, createElement(Probe))))
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("The new row has an empty value for each top-level column", () => {
        let rowId: string | null = null
        act(() => {
            rowId = latest?.addRow() ?? null
        })

        expect(store.get(testcaseMolecule.atoms.data(rowId as unknown as string))?.data).toEqual({
            country: "",
            outputs: "",
            meta: {source: ""},
        })
    })

    it("A test set with only nested columns gets a field for each of them", () => {
        expect(emptyRowData(["inputs.question", "inputs.context", "meta"])).toEqual({
            inputs: {question: "", context: ""},
            meta: "",
        })
        // A parent column next to its children is filled by the children.
        expect(emptyRowData(["inputs", "inputs.question"])).toEqual({inputs: {question: ""}})
    })
})
