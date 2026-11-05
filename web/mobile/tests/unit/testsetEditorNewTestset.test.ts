// @vitest-environment jsdom
// A new test set opens as in the old app: the columns `input` and `correct_answer` and one empty
// row. Without a row the grid has no column, no "Add column" and no field to fill in.
import {StrictMode, createElement, act} from "react"

import {testcaseDataController, testcaseMolecule} from "@agenta/entities/testcase"
import {createStore, Provider, useAtomValue} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useTestsetEditor} from "@/features/testsets/detail/useTestsetEditor"

vi.mock("@agenta/ui/app-message", () => ({
    message: {success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => vi.fn())},
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let latest: ReturnType<typeof useTestsetEditor> | null = null
let columnKeys: string[] = []
function Probe() {
    latest = useTestsetEditor({projectId: "pr", routeId: "new", nameFromUrl: "Capitals"})
    const columns = useAtomValue(testcaseDataController.selectors.columns(latest.tableConfig))
    columnKeys = columns.map((column) => column.key)
    return null
}

describe("useTestsetEditor on a new test set", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
        // Strict mode runs the effects twice, as the dev server does.
        act(() =>
            root.render(
                createElement(
                    StrictMode,
                    null,
                    createElement(Provider, {store}, createElement(Probe)),
                ),
            ),
        )
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("starts with one empty row and the input and correct_answer columns", () => {
        const ids = store.get(testcaseMolecule.newIds)
        expect(ids).toHaveLength(1)
        expect(store.get(testcaseMolecule.atoms.data(ids[0]))?.data).toEqual({
            input: "",
            correct_answer: "",
        })
        expect(columnKeys).toEqual(["input", "correct_answer"])
    })

    it("gives a row added next a field for each starter column", () => {
        let rowId: string | null = null
        act(() => {
            rowId = latest?.addRow() ?? null
        })
        expect(store.get(testcaseMolecule.atoms.data(rowId as unknown as string))?.data).toEqual({
            input: "",
            correct_answer: "",
        })
    })
})
