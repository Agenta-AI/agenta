// @vitest-environment jsdom
import {useState} from "react"

import {act, cleanup, render, waitFor} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    resetSystemBackForTests,
    restartSystemBack,
    useSystemBack,
    type SystemBackRank,
} from "../../src/view-stack/systemBack"

/** A level that is open until its back says it may close. */
const Level = ({
    rank = "view",
    open: initiallyOpen = true,
    ask = () => true,
    onBack,
}: {
    rank?: SystemBackRank
    open?: boolean
    ask?: () => Promise<boolean> | boolean
    onBack?: () => void
}) => {
    const [open, setOpen] = useState(initiallyOpen)
    useSystemBack(open ? 1 : 0, rank, async () => {
        onBack?.()
        const left = await ask()
        if (left) setOpen(false)
        return left
    })
    return open ? <p>{rank} open</p> : null
}

/** A browser move to the level entry at `position` of the current run (0: the page itself). */
const move = (position: number) => {
    const run = (push.mock.lastCall?.[0] as {agSystemBackRun?: string} | undefined)?.agSystemBackRun
    act(() =>
        window.dispatchEvent(
            new PopStateEvent("popstate", {
                state: position ? {agSystemBack: position, agSystemBackRun: run} : null,
            }),
        ),
    )
}
const settle = () => act(async () => await Promise.resolve())

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
    it("pushes one history entry per open level, and none when no level is open", () => {
        render(<Level open={false} />)
        expect(push).not.toHaveBeenCalled()
        cleanup()
        render(
            <>
                <Level rank="panel" />
                <Level rank="view" />
            </>,
        )
        expect(push).toHaveBeenCalledTimes(2)
    })

    it("closes the level on a browser back and gives its entry back", async () => {
        const {queryByText} = render(<Level />)
        move(0)
        await waitFor(() => expect(queryByText("view open")).toBeNull())
        await settle()
        // The back is undone at once, and the close gives the entry back.
        expect(push).toHaveBeenCalledTimes(2)
        expect(go).toHaveBeenCalledWith(-1)
    })

    it("keeps the level and its entry when the person stays, and asks again on the next back", async () => {
        const onBack = vi.fn()
        const {getByText} = render(<Level ask={async () => false} onBack={onBack} />)
        move(0)
        await settle()
        expect(getByText("view open")).toBeTruthy()
        expect(go).not.toHaveBeenCalled()
        move(0)
        await settle()
        expect(onBack).toHaveBeenCalledTimes(2)
    })

    it("does nothing on a second back while the first one asks", async () => {
        let answer: (left: boolean) => void = () => undefined
        const viewBack = vi.fn()
        const panelBack = vi.fn()
        render(
            <>
                <Level rank="panel" onBack={panelBack} />
                <Level
                    rank="view"
                    onBack={viewBack}
                    ask={() => new Promise<boolean>((resolve) => (answer = resolve))}
                />
            </>,
        )
        move(1)
        move(1)
        await settle()
        expect(viewBack).toHaveBeenCalledTimes(1)
        expect(panelBack).not.toHaveBeenCalled()
        // Each back was undone, so the history still holds both levels.
        expect(push).toHaveBeenCalledTimes(4)
        await act(async () => answer(false))
    })

    it("does not run a back on a browser forward", async () => {
        const onBack = vi.fn()
        render(<Level onBack={onBack} />)
        // Forward onto the entry of a level that closed earlier.
        move(2)
        await settle()
        expect(onBack).not.toHaveBeenCalled()
        expect(go).toHaveBeenCalledWith(-1)
    })

    it("reads an entry of an earlier run as the page under the levels", async () => {
        const onBack = vi.fn()
        const {unmount} = render(<Level />)
        const earlier = push.mock.calls[0][0]
        unmount()
        await settle()
        // The pop of that history.go (mocked here).
        move(0)
        render(<Level onBack={onBack} />)
        // Back onto an entry of the earlier run, which still says "position 1".
        act(() => window.dispatchEvent(new PopStateEvent("popstate", {state: earlier})))
        await settle()
        expect(onBack).toHaveBeenCalledTimes(1)
    })

    it("gives the entries of a panel and its view back with one history.go", async () => {
        const {rerender} = render(
            <>
                <Level rank="panel" />
                <Level rank="view" />
            </>,
        )
        rerender(<></>)
        await settle()
        expect(go).toHaveBeenCalledTimes(1)
        expect(go).toHaveBeenCalledWith(-2)
    })

    it("closes a view before the panel around it, whatever order the entries came in", async () => {
        const panelBack = vi.fn()
        const viewBack = vi.fn()
        // The view renders first, so its entry is pushed first (a child's effects run first).
        render(
            <>
                <Level rank="view" onBack={viewBack} />
                <Level rank="panel" onBack={panelBack} />
            </>,
        )
        move(1)
        await settle()
        expect(viewBack).toHaveBeenCalledTimes(1)
        expect(panelBack).not.toHaveBeenCalled()
        await waitFor(() => expect(go).toHaveBeenCalledWith(-1))
        // The pop of that history.go (mocked here) lands on the panel's entry.
        move(1)
        move(0)
        await settle()
        expect(panelBack).toHaveBeenCalledTimes(1)
    })

    it("keeps the back from the router while a level handles it", () => {
        const router = vi.fn()
        window.addEventListener("popstate", router)
        render(<Level />)
        move(0)
        expect(router).not.toHaveBeenCalled()
        window.removeEventListener("popstate", router)
    })

    it("lets the router have the back when no level is open", () => {
        const router = vi.fn()
        window.addEventListener("popstate", router)
        render(<Level open={false} />)
        move(0)
        expect(router).toHaveBeenCalledTimes(1)
        expect(go).not.toHaveBeenCalled()
        window.removeEventListener("popstate", router)
    })

    it("does not go back over a page the person navigated away from", async () => {
        const {unmount} = render(<Level />)
        // A navigation pushes the new page with a new router key.
        window.history.replaceState({key: "new-page"}, "")
        unmount()
        await settle()
        expect(go).not.toHaveBeenCalled()
        window.history.replaceState(null, "")
    })

    it("moves an open level's entry to the new page after a navigation", () => {
        render(<Level />)
        expect(push).toHaveBeenCalledTimes(1)
        restartSystemBack()
        expect(push).toHaveBeenCalledTimes(2)
    })
})
