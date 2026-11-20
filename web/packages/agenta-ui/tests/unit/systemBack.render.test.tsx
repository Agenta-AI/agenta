// @vitest-environment jsdom
import {act, cleanup, render, waitFor} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    resetSystemBackForTests,
    restartSystemBack,
    useSystemBack,
    type SystemBackRank,
} from "../../src/view-stack/systemBack"

const Level = ({
    levels,
    rank = "view",
    onBack,
}: {
    levels: number
    rank?: SystemBackRank
    onBack: () => Promise<boolean> | boolean
}) => {
    useSystemBack(levels, rank, onBack)
    return null
}

const pop = () => act(() => window.dispatchEvent(new PopStateEvent("popstate", {state: null})))
const flushMicrotasks = () => act(() => Promise.resolve())

let push: ReturnType<typeof vi.spyOn>
let go: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    push = vi.spyOn(window.history, "pushState")
    go = vi.spyOn(window.history, "go").mockImplementation(() => undefined)
})

afterEach(() => {
    cleanup()
    resetSystemBackForTests()
    vi.restoreAllMocks()
})

describe("useSystemBack", () => {
    it("pushes one history entry per open level, and none on a desktop", () => {
        const {rerender} = render(<Level levels={0} onBack={() => true} />)
        expect(push).not.toHaveBeenCalled()
        rerender(<Level levels={1} onBack={() => true} />)
        rerender(<Level levels={2} onBack={() => true} />)
        expect(push).toHaveBeenCalledTimes(2)
    })

    it("runs the level's back on a browser back", async () => {
        const onBack = vi.fn(() => true)
        render(<Level levels={1} onBack={onBack} />)
        pop()
        expect(onBack).toHaveBeenCalledTimes(1)
    })

    it("puts the entry back when the person stays", async () => {
        const onBack = vi.fn(async () => false)
        render(<Level levels={1} onBack={onBack} />)
        expect(push).toHaveBeenCalledTimes(1)
        pop()
        await waitFor(() => expect(push).toHaveBeenCalledTimes(2))
        // A second back reaches the level again.
        pop()
        expect(onBack).toHaveBeenCalledTimes(2)
    })

    it("gives the entry back with one history.go when the app closes the level", async () => {
        const {rerender} = render(<Level levels={1} onBack={() => true} />)
        rerender(<Level levels={0} onBack={() => true} />)
        await flushMicrotasks()
        expect(go).toHaveBeenCalledWith(-1)
        // The pop that history.go causes is not a back of the person.
        const onBack = vi.fn(() => true)
        rerender(<Level levels={0} onBack={onBack} />)
        pop()
        expect(onBack).not.toHaveBeenCalled()
    })

    it("closes the panel and its view with one history.go", async () => {
        const {rerender} = render(
            <>
                <Level levels={1} rank="panel" onBack={() => true} />
                <Level levels={1} rank="view" onBack={() => true} />
            </>,
        )
        rerender(
            <>
                <Level levels={0} rank="panel" onBack={() => true} />
                <Level levels={0} rank="view" onBack={() => true} />
            </>,
        )
        await flushMicrotasks()
        expect(go).toHaveBeenCalledTimes(1)
        expect(go).toHaveBeenCalledWith(-2)
    })

    it("closes a view before the panel around it, whatever order the entries came in", () => {
        const panelBack = vi.fn(() => true)
        const viewBack = vi.fn(() => true)
        // The view renders first, so its entry is pushed first (a child's effects run first).
        render(
            <>
                <Level levels={1} rank="view" onBack={viewBack} />
                <Level levels={1} rank="panel" onBack={panelBack} />
            </>,
        )
        pop()
        expect(viewBack).toHaveBeenCalledTimes(1)
        expect(panelBack).not.toHaveBeenCalled()
        pop()
        expect(panelBack).toHaveBeenCalledTimes(1)
    })

    it("keeps the back from the router while a level handles it", () => {
        const router = vi.fn()
        window.addEventListener("popstate", router)
        render(<Level levels={1} onBack={() => true} />)
        pop()
        expect(router).not.toHaveBeenCalled()
        window.removeEventListener("popstate", router)
    })

    it("does not go back over a page the person navigated away from", async () => {
        const {unmount} = render(<Level levels={1} onBack={() => true} />)
        // A navigation pushes the new page with a new router key.
        window.history.replaceState({key: "new-page"}, "")
        unmount()
        await flushMicrotasks()
        expect(go).not.toHaveBeenCalled()
        window.history.replaceState(null, "")
    })

    it("moves an open level's entry to the new page after a navigation", () => {
        render(<Level levels={1} onBack={() => true} />)
        expect(push).toHaveBeenCalledTimes(1)
        restartSystemBack()
        expect(push).toHaveBeenCalledTimes(2)
    })

    it("does nothing on a browser back when no level is open", () => {
        const onBack = vi.fn(() => true)
        render(<Level levels={0} onBack={onBack} />)
        pop()
        expect(onBack).not.toHaveBeenCalled()
        expect(go).not.toHaveBeenCalled()
    })
})
