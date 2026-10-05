// @vitest-environment jsdom
import {createRef} from "react"

import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/shared/utils", () => ({generateId: () => "quote-scroll-test"}))
vi.mock("../../src/QuoteSelection/useQuoteHighlights", () => ({useDraftHighlight: () => {}}))

const state = vi.hoisted(() => ({candidate: null as unknown, dismiss: vi.fn()}))
vi.mock("../../src/QuoteSelection/useQuoteSelection", () => ({
    useQuoteSelection: () => ({candidate: state.candidate, dismiss: state.dismiss}),
    renderedSelection: () => ({before: "", rendered: "Selected passage"}),
    rectIn: () => ({top: 150, left: 200, bottom: 170, width: 100}),
}))

import {QuoteSelectionLayer} from "../../src/QuoteSelection/QuoteSelectionLayer"
import {clearQuotes, getQuotes, registerQuoteSubmit} from "../../src/QuoteSelection/store"

const sessionId = "quote-scroll-session"

beforeEach(() => {
    clearQuotes(sessionId)
    state.dismiss.mockClear()
})

afterEach(() => {
    cleanup()
    clearQuotes(sessionId)
    vi.restoreAllMocks()
})

function openReply() {
    const rootRef = createRef<HTMLDivElement>()
    const target = document.createElement("div")
    target.textContent = "Selected passage"
    const range = document.createRange()
    range.selectNodeContents(target)
    state.candidate = {
        text: "Selected passage",
        source: {kind: "file", path: "long.md", displayPath: "long.md", fileName: "long.md"},
        target,
        range,
        rect: {top: 150, left: 200, bottom: 170, width: 100},
    }
    render(
        <div ref={rootRef} tabIndex={0}>
            <QuoteSelectionLayer rootRef={rootRef} sessionId={sessionId} />
        </div>,
    )
    // The file pane is keyboard-focusable and may have an offscreen native selection.
    rootRef.current!.focus()
    const focus = vi.spyOn(HTMLElement.prototype, "focus")
    fireEvent.click(screen.getByRole("button", {name: "Reply"}))
    return {root: rootRef.current!, focus, input: screen.getByPlaceholderText("Reply to the agent")}
}

describe("quote reply focus preserves the file pane's scroll position", () => {
    it("focuses the note without scrolling when the dialog opens", () => {
        const {focus, input} = openReply()
        expect(document.activeElement).toBe(input)
        expect(focus).toHaveBeenCalledWith({preventScroll: true})
    })

    it.each(["Enter", "button", "Escape", "outside", "send"])(
        "restores focus without scrolling after %s",
        (action) => {
            const submit = vi.fn()
            const unregister = registerQuoteSubmit(sessionId, submit)
            try {
                const {root, focus, input} = openReply()
                focus.mockClear()
                fireEvent.change(input, {target: {value: "Keep this passage in view"}})
                if (action === "button")
                    fireEvent.click(screen.getByRole("button", {name: "Add to message"}))
                else if (action === "outside") fireEvent.pointerDown(document.body)
                else
                    fireEvent.keyDown(input, {
                        key: action === "Escape" ? "Escape" : "Enter",
                        ctrlKey: action === "send",
                    })
                expect(screen.queryByRole("dialog")).toBeNull()
                expect(document.activeElement).toBe(root)
                expect(focus).toHaveBeenCalledWith({preventScroll: true})
                if (action === "Escape" || action === "outside")
                    expect(getQuotes(sessionId)).toHaveLength(0)
                else
                    expect(getQuotes(sessionId)[0]).toMatchObject({
                        text: "Selected passage",
                        note: "Keep this passage in view",
                        staged: true,
                    })
                expect(submit).toHaveBeenCalledTimes(action === "send" ? 1 : 0)
            } finally {
                unregister()
            }
        },
    )
})
