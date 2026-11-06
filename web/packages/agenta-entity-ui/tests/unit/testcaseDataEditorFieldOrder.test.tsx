/**
 * The form of TestcaseDataEditor without a column list, as the test set drawer uses it. By
 * default the fields are sorted and each one can be deleted, as before. A test set editor asks
 * for the row order and no field controls, as in the old app: a field belongs to every row, so
 * it changes only through the column actions.
 */
import {act} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {TestcaseDataEditor} from "../../src/testcase/TestcaseDataEditor"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
}

const ROW = {question: "What is the refund window?", answer: "30 days", context: "Policy"}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const render = async (props: Partial<Parameters<typeof TestcaseDataEditor>[0]>) => {
    await act(async () => {
        root.render(
            <TestcaseDataEditor
                value={ROW}
                onChange={vi.fn()}
                mode="edit"
                surface="drawer"
                rootViewMode="form"
                {...props}
            />,
        )
    })
}

/** The field names in the order the form shows them. */
const fieldNames = () => {
    const text = container.textContent ?? ""
    return Object.keys(ROW)
        .map((key) => ({key, at: text.indexOf(key)}))
        .filter(({at}) => at >= 0)
        .sort((a, b) => a.at - b.at)
        .map(({key}) => key)
}

/** The delete button of each field. */
const deleteButtons = () => container.querySelectorAll('button[aria-label="Delete field"]')

describe("TestcaseDataEditor fields without a column list", () => {
    it("By default the fields are sorted and each field can be deleted", async () => {
        await render({})
        expect(fieldNames()).toEqual(["answer", "context", "question"])
        expect(deleteButtons()).toHaveLength(3)
    })

    it("A test set editor gets the fields in row order and no delete buttons", async () => {
        await render({fieldOrder: "data", fieldControls: false})
        expect(fieldNames()).toEqual(["question", "answer", "context"])
        expect(deleteButtons()).toHaveLength(0)
    })
})
