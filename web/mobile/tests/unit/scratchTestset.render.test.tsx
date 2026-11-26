// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ScratchTestsetStep} from "@/features/testsets/create/ScratchTestsetStep"

const push = vi.hoisted(() => vi.fn())
vi.mock("next/router", () => ({useRouter: () => ({push})}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

describe("Create from scratch step", () => {
    let root: Root
    let host: HTMLDivElement
    const onClose = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        act(() => root.render(<ScratchTestsetStep base="/w/ws/p/pr" onClose={onClose} />))
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const input = () => host.querySelector<HTMLInputElement>("input")!
    const type = async (value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        await act(async () => {
            setter.call(input(), value)
            input().dispatchEvent(new Event("input", {bubbles: true}))
        })
    }
    const create = () =>
        Array.from(host.querySelectorAll("button")).find(
            (button) => button.textContent === "Create test set",
        )!

    it("Create from scratch goes to the new test set route with the encoded name", async () => {
        await type("  Q&A / 2026  ")
        await act(async () => create().click())
        expect(push).toHaveBeenCalledWith("/w/ws/p/pr/testsets/new?name=Q%26A%20%2F%202026")
        expect(onClose).toHaveBeenCalled()
    })

    it("Create test set is disabled without a name", async () => {
        expect(create().disabled).toBe(true)
        await type("   ")
        expect(create().disabled).toBe(true)
        await type("Cases")
        expect(create().disabled).toBe(false)
    })
})
