// @vitest-environment jsdom
/**
 * One lazy module serves every trace drawer header slot. The props tell the slots apart.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/features/annotations/AddToQueuePicker", () => ({
    default: ({itemIds}: {itemIds?: string[]}) => <div>queue:{itemIds?.join(",")}</div>,
}))
vi.mock("@/features/observability/addToTestset/AddToTestsetDrawerButton", () => ({
    AddToTestsetDrawerButton: ({spanIds}: {spanIds?: string[]}) => (
        <div>testset:{spanIds?.join(",")}</div>
    ),
}))

import TraceDrawerHeaderAction from "@/features/observability/TraceDrawerHeaderActions"

describe("trace drawer header actions", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("The add-to-queue slot renders the queue picker", () => {
        act(() =>
            root.render(
                <TraceDrawerHeaderAction itemType="traces" itemIds={["t-1"]}>
                    <span />
                </TraceDrawerHeaderAction>,
            ),
        )
        expect(host.textContent).toBe("queue:t-1")
    })

    it("The add to test set slot renders the test set button", () => {
        act(() => root.render(<TraceDrawerHeaderAction label="Add to testset" spanIds={["s-1"]} />))
        expect(host.textContent).toBe("testset:s-1")
    })
})
