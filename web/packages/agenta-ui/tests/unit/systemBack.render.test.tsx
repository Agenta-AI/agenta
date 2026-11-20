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
        if (await ask()) setOpen(false)
    })
    return open ? <p>{rank} open</p> : null
}

const pop = (state: unknown = null) =>
    act(() => window.dispatchEvent(new PopStateEvent("popstate", {state})))
const settle = () => act(async () => await Promise.resolve())
/** The state the module pushed last (the barrier). */
const lastPushed = () => push.mock.lastCall?.[0]

let push: ReturnType<typeof vi.spyOn>
let back: ReturnType<typeof vi.spyOn>
let router: ReturnType<typeof vi.fn>

beforeEach(() => {
    push = vi.spyOn(window.history, "pushState")
    back = vi.spyOn(window.history, "back").mockImplementation(() => undefined)
    router = vi.fn()
    window.addEventListener("popstate", router)
})

afterEach(() => {
    window.removeEventListener("popstate", router)
    cleanup()
    resetSystemBackForTests()
    window.history.replaceState(null, "")
    vi.restoreAllMocks()
})

describe("useSystemBack", () => {
    it("pushes one history entry while any level is open, and none when no level is open", async () => {
        render(<Level open={false} />)
        await settle()
        expect(push).not.toHaveBeenCalled()
        cleanup()
        render(
            <>
                <Level rank="panel" />
                <Level rank="view" />
            </>,
        )
        await settle()
        expect(push).toHaveBeenCalledTimes(1)
    })

    it("closes the level on a browser back, and the entry goes with the last level", async () => {
        const {queryByText} = render(<Level />)
        await settle()
        pop()
        await waitFor(() => expect(queryByText("view open")).toBeNull())
        await settle()
        // The back was undone at once; the close then takes the entry away.
        expect(push).toHaveBeenCalledTimes(2)
        expect(back).toHaveBeenCalledTimes(1)
        expect(router).not.toHaveBeenCalled()
    })

    it("keeps the level and the entry when the person stays, and asks again on the next back", async () => {
        const onBack = vi.fn()
        const {getByText} = render(<Level ask={async () => false} onBack={onBack} />)
        await settle()
        pop()
        await settle()
        expect(getByText("view open")).toBeTruthy()
        expect(back).not.toHaveBeenCalled()
        pop()
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
        await settle()
        pop()
        pop()
        await settle()
        expect(viewBack).toHaveBeenCalledTimes(1)
        expect(panelBack).not.toHaveBeenCalled()
        // Each back was undone.
        expect(push).toHaveBeenCalledTimes(3)
        await act(async () => answer(false))
    })

    it("closes a view before the panel around it, whatever order they opened in", async () => {
        const panelBack = vi.fn()
        const viewBack = vi.fn()
        render(
            <>
                <Level rank="view" onBack={viewBack} />
                <Level rank="panel" onBack={panelBack} />
            </>,
        )
        await settle()
        pop()
        await settle()
        expect(viewBack).toHaveBeenCalledTimes(1)
        expect(panelBack).not.toHaveBeenCalled()
        pop()
        await settle()
        expect(panelBack).toHaveBeenCalledTimes(1)
    })

    it("lets the router have the back when no level is open", async () => {
        render(<Level open={false} />)
        await settle()
        pop()
        expect(router).toHaveBeenCalledTimes(1)
        expect(back).not.toHaveBeenCalled()
    })

    it("steps over the entry of levels that closed earlier", async () => {
        const {unmount} = render(<Level />)
        await settle()
        const earlier = lastPushed()
        unmount()
        await settle()
        // The pop of that history.back (mocked here).
        pop()
        expect(router).not.toHaveBeenCalled()
        // Later the person comes back onto that entry through the history.
        pop(earlier)
        expect(back).toHaveBeenCalledTimes(2)
        expect(router).not.toHaveBeenCalled()
    })

    it("steps forward over an old entry when the person comes back onto it from below", async () => {
        const forward = vi.spyOn(window.history, "forward").mockImplementation(() => undefined)
        const {unmount} = render(<Level />)
        await settle()
        const earlier = lastPushed()
        unmount()
        await settle()
        // The pop of that history.back (mocked here).
        pop()
        // Back from the next page onto the old entry: step back over it.
        pop(earlier)
        expect(back).toHaveBeenCalledTimes(2)
        // The pop of that step lands under it.
        pop()
        // Forward onto the old entry again: step forward, toward the next page.
        pop(earlier)
        expect(forward).toHaveBeenCalledTimes(1)
        expect(back).toHaveBeenCalledTimes(2)
    })

    it("lets a back run again after a jump away while a question was open", async () => {
        const onBack = vi.fn()
        render(<Level onBack={onBack} ask={() => new Promise<boolean>(() => undefined)} />)
        await settle()
        pop()
        await settle()
        expect(onBack).toHaveBeenCalledTimes(1)
        // A jump to another page's entry from the history menu: the question loses its page.
        pop({key: "earlier-page"})
        restartSystemBack()
        await settle()
        pop()
        await settle()
        expect(onBack).toHaveBeenCalledTimes(2)
    })

    it("keeps a URL the router wrote on the entry while it was leaving", async () => {
        const replace = vi.spyOn(window.history, "replaceState")
        const {unmount} = render(<Level />)
        await settle()
        unmount()
        await settle()
        expect(back).toHaveBeenCalledTimes(1)
        // A shallow router.replace hits the entry before the traversal lands under it.
        window.history.replaceState({key: null, as: "/page?tab=agent"}, "", "/page?tab=agent")
        replace.mockClear()
        // The traversal lands (the pop of that history.back, mocked here).
        pop()
        expect(replace).toHaveBeenCalledWith(
            {key: null, as: "/page?tab=agent"},
            "",
            "/page?tab=agent",
        )
    })

    it("keeps a URL the router wrote on the entry before it started to leave", async () => {
        const replace = vi.spyOn(window.history, "replaceState")
        const {unmount} = render(<Level />)
        await settle()
        // The rewrite comes first, then the close.
        window.history.replaceState({key: null}, "", "/page?tab=agent")
        unmount()
        await settle()
        replace.mockClear()
        pop()
        expect(replace).toHaveBeenCalledWith(
            {key: null},
            "",
            expect.stringContaining("/page?tab=agent"),
        )
    })

    it("lets the router take a jump to another page's entry", async () => {
        const onBack = vi.fn()
        render(<Level onBack={onBack} />)
        await settle()
        pop({key: "earlier-page"})
        await settle()
        expect(onBack).not.toHaveBeenCalled()
        expect(router).toHaveBeenCalledTimes(1)
    })

    it("does not go back over a page the person navigated away from", async () => {
        const {unmount} = render(<Level />)
        await settle()
        // A navigation pushes the new page with a new router key.
        window.history.replaceState({key: "new-page"}, "")
        unmount()
        await settle()
        expect(back).not.toHaveBeenCalled()
    })

    it("gives an open level a new entry on the new page after a navigation", async () => {
        render(<Level />)
        await settle()
        expect(push).toHaveBeenCalledTimes(1)
        // A move the leave guard stopped stays on the page: the entry is still right.
        restartSystemBack()
        await settle()
        expect(push).toHaveBeenCalledTimes(1)
        window.history.replaceState({key: "new-page"}, "")
        restartSystemBack()
        await settle()
        expect(push).toHaveBeenCalledTimes(2)
    })

    it("takes the entry away once when a panel and its view close together", async () => {
        const {rerender} = render(
            <>
                <Level rank="panel" />
                <Level rank="view" />
            </>,
        )
        await settle()
        rerender(<></>)
        await settle()
        expect(back).toHaveBeenCalledTimes(1)
    })
})
