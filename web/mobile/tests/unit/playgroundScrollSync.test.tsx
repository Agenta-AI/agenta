// @vitest-environment jsdom
/** The compare view keeps the sideways scroll of its config area and its run area in step. */
import {act} from "react"

import {usePlaygroundScrollSync} from "@agenta/playground-ui/hooks"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

let root: Root
let host: HTMLDivElement

const Harness = ({enabled}: {enabled: boolean}) => {
    const {setConfigPanelRef, setGenerationPanelRef} = usePlaygroundScrollSync({enabled})
    return (
        <>
            <div data-testid="config" ref={setConfigPanelRef} />
            <div data-testid="runs" ref={setGenerationPanelRef} />
        </>
    )
}

const area = (id: string) => host.querySelector<HTMLDivElement>(`[data-testid=${id}]`)!
const scrollTo = (element: HTMLElement, left: number) => {
    element.scrollLeft = left
    element.dispatchEvent(new Event("scroll"))
}
const wait = (ms: number) =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms))
    })

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("usePlaygroundScrollSync", () => {
    it("Scrolling one area sideways scrolls the other one to the same place", () => {
        act(() => root.render(<Harness enabled />))

        scrollTo(area("config"), 120)
        expect(area("runs").scrollLeft).toBe(120)
    })

    it("Works in both directions once a scroll has ended", async () => {
        act(() => root.render(<Harness enabled />))
        scrollTo(area("config"), 120)
        await wait(200)

        scrollTo(area("runs"), 40)
        expect(area("config").scrollLeft).toBe(40)
    })

    it("The scroll it sets does not bounce back to the area the user scrolls", () => {
        act(() => root.render(<Harness enabled />))
        scrollTo(area("config"), 120)
        // The browser fires a scroll on the area that followed; it must not move the source.
        area("config").scrollLeft = 130
        area("runs").dispatchEvent(new Event("scroll"))

        expect(area("config").scrollLeft).toBe(130)
    })

    it("Does nothing while it is off", () => {
        act(() => root.render(<Harness enabled={false} />))

        scrollTo(area("config"), 120)
        expect(area("runs").scrollLeft).toBe(0)
    })
})
