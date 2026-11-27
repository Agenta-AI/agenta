// @vitest-environment jsdom
import {useState} from "react"

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {RightPane, RightPaneHost} from "../../src/components/composed/right-pane"

/** A controllable `matchMedia`: the expanded-window query follows `wide`. */
let wide = true
const listeners = new Set<() => void>()
const setWide = (next: boolean) => {
    wide = next
    act(() => listeners.forEach((listener) => listener()))
}

beforeEach(() => {
    wide = true
    listeners.clear()
    window.matchMedia = ((query: string) => ({
        get matches() {
            return query.includes("min-width: 1024px") ? wide : false
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    })) as unknown as typeof window.matchMedia
})

afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

const slot = () => document.querySelector("[data-slot=right-pane-slot]") as HTMLElement

describe("RightPane", () => {
    it("shows one pane at a time: opening a second closes the first", () => {
        const closeA = vi.fn()
        const Two = () => {
            const [b, setB] = useState(false)
            return (
                <RightPaneHost>
                    <button onClick={() => setB(true)}>open b</button>
                    <RightPane open onOpenChange={closeA} title="Pane A">
                        A body
                    </RightPane>
                    <RightPane open={b} onOpenChange={setB} title="Pane B">
                        B body
                    </RightPane>
                </RightPaneHost>
            )
        }
        render(<Two />)
        expect(slot().textContent).toContain("Pane A")
        fireEvent.click(screen.getByText("open b"))
        expect(closeA).toHaveBeenCalledWith(false)
        expect(slot().textContent).toContain("Pane B")
    })

    it("swapping the item a keyed pane shows keeps the new pane open", () => {
        const Swap = () => {
            const [item, setItem] = useState<string | null>("a")
            return (
                <RightPaneHost>
                    <button onClick={() => setItem("b")}>show b</button>
                    {item ? (
                        <RightPane key={item} open onOpenChange={() => setItem(null)} title={item}>
                            {`item ${item}`}
                        </RightPane>
                    ) : null}
                </RightPaneHost>
            )
        }
        render(<Swap />)
        fireEvent.click(screen.getByText("show b"))
        expect(slot().textContent).toContain("item b")
    })

    it("keeps its content through the closing slide, then lets it go", () => {
        vi.useFakeTimers()
        const Closing = () => {
            const [open, setOpen] = useState(true)
            return (
                <RightPaneHost>
                    <button onClick={() => setOpen(false)}>close</button>
                    <RightPane open={open} onOpenChange={setOpen} title="Pane">
                        pane body
                    </RightPane>
                </RightPaneHost>
            )
        }
        render(<Closing />)
        fireEvent.click(screen.getByText("close"))
        expect(document.body.textContent).toContain("pane body")
        act(() => vi.advanceTimersByTime(400))
        expect(document.body.textContent).not.toContain("pane body")
    })

    it("keeps the content mounted when the window crosses the breakpoint", () => {
        const Draft = () => {
            const [text, setText] = useState("")
            return (
                <input aria-label="draft" value={text} onChange={(e) => setText(e.target.value)} />
            )
        }
        render(
            <RightPaneHost>
                <RightPane open onOpenChange={() => undefined} title="Ask">
                    <Draft />
                </RightPane>
            </RightPaneHost>,
        )
        fireEvent.change(screen.getByLabelText("draft"), {target: {value: "half a question"}})
        setWide(false)
        expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("half a question")
        setWide(true)
        expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("half a question")
    })

    it("docked, takes the focus when it opens, unless focusOnOpen is false", () => {
        const Page = ({focusOnOpen}: {focusOnOpen?: boolean}) => (
            <RightPaneHost>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input aria-label="name" autoFocus />
                <RightPane
                    open
                    onOpenChange={() => undefined}
                    title="Files"
                    focusOnOpen={focusOnOpen}
                >
                    files
                </RightPane>
            </RightPaneHost>
        )
        render(<Page />)
        expect(document.activeElement?.tagName).toBe("ASIDE")
        cleanup()
        render(<Page focusOnOpen={false} />)
        expect(document.activeElement).toBe(screen.getByLabelText("name"))
    })

    it("resizes from the keyboard within 320 and 560px", () => {
        render(
            <RightPaneHost>
                <RightPane open onOpenChange={() => undefined} title="Ask">
                    body
                </RightPane>
            </RightPaneHost>,
        )
        const handle = screen.getByRole("separator")
        expect(handle.getAttribute("aria-valuenow")).toBe("320")
        fireEvent.keyDown(handle, {key: "ArrowLeft"})
        expect(handle.getAttribute("aria-valuenow")).toBe("336")
        fireEvent.keyDown(handle, {key: "End"})
        expect(handle.getAttribute("aria-valuenow")).toBe("560")
        fireEvent.keyDown(handle, {key: "ArrowLeft"})
        expect(handle.getAttribute("aria-valuenow")).toBe("560")
        fireEvent.keyDown(handle, {key: "Home"})
        expect(handle.getAttribute("aria-valuenow")).toBe("320")
    })
})
