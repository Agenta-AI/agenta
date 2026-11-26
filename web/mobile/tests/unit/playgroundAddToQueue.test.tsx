// @vitest-environment jsdom
/**
 * The focus drawer's "Add to queue": shown for a test case of a connected test set, as in /w,
 * and absent for local rows, which no queue can hold. Real loadable state; the picker is a stub.
 */
import {act, type ReactNode} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("next/dynamic", () => ({
    default:
        () =>
        ({children, itemIds}: {children: ReactNode; itemIds: string[]}) => (
            <div data-testid="queue-picker" data-items={itemIds.join(",")}>
                {children}
            </div>
        ),
}))

import {usePlaygroundAddToQueue} from "@/features/playground/usePlaygroundAddToQueue"

const store = getDefaultStore()
const LOADABLE = "testset:workflow:rev-queue"
let render: ReturnType<typeof usePlaygroundAddToQueue>
let root: Root

const Harness = () => {
    render = usePlaygroundAddToQueue(LOADABLE)
    return null
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
    act(() => root.unmount())
    store.set(loadableController.actions.disconnect, LOADABLE)
    document.body.innerHTML = ""
})

describe("usePlaygroundAddToQueue", () => {
    it("Local rows get no Add to queue", () => {
        act(() => root.render(<Harness />))
        expect(render).toBeUndefined()
    })

    it("A connected test case gets Add to queue with its id", () => {
        act(() => {
            store.set(
                loadableController.actions.connectToSource,
                LOADABLE,
                "ts-rev-1",
                "Cases v1",
                [{id: "tc-1", data: {country: "Peru"}}],
            )
        })
        act(() => root.render(<Harness />))
        expect(render).toBeTypeOf("function")

        act(() => root.render(<>{render?.(["tc-1"])}</>))
        const picker = document.querySelector("[data-testid=queue-picker]")
        expect(picker?.getAttribute("data-items")).toBe("tc-1")
        expect(picker?.textContent).toContain("Add to queue")
    })

    it("A new row of a connected test set gets no Add to queue", () => {
        act(() => {
            store.set(
                loadableController.actions.connectToSource,
                LOADABLE,
                "ts-rev-1",
                "Cases v1",
                [{id: "tc-1", data: {country: "Peru"}}],
            )
        })
        act(() => root.render(<Harness />))
        expect(render?.([])).toBeNull()
    })
})
