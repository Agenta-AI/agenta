import {act, createElement} from "react"

import {getDefaultStore} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {commitLoaded} = vi.hoisted(() => ({commitLoaded: vi.fn()}))

vi.mock("../../src/modals/commit", async () => {
    commitLoaded()
    const {useAtomValue} = await import("jotai")
    const {commitModalOpenAtom} = await import("../../src/modals/commit/state")
    return {
        EntityCommitModal: () =>
            createElement("div", {
                "data-testid": "commit",
                "data-open": String(useAtomValue(commitModalOpenAtom)),
            }),
    }
})

import {openCommitModalAtom, commitModalOpenAtom} from "../../src/modals/commit/state"
import {EntityModalsProvider} from "../../src/modals/EntityActionProvider"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const commit = () => host.querySelector('[data-testid="commit"]')

const flush = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve))
    })
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("EntityModalsProvider", () => {
    it("loads a modal on its first open and keeps it mounted through the close", async () => {
        await act(async () => {
            root.render(createElement(EntityModalsProvider, null, "app"))
        })
        await flush()
        expect(commitLoaded).not.toHaveBeenCalled()
        expect(commit()).toBeNull()

        await act(async () => {
            getDefaultStore().set(openCommitModalAtom, {type: "revision", id: "r1", name: "v1"})
        })
        await flush()
        expect(commitLoaded).toHaveBeenCalledTimes(1)
        expect(commit()?.getAttribute("data-open")).toBe("true")

        await act(async () => {
            getDefaultStore().set(commitModalOpenAtom, false)
        })
        expect(commit()?.getAttribute("data-open")).toBe("false")
    })
})
