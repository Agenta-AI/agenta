// @vitest-environment jsdom
import {createRef} from "react"

import type {PreviewAnchor} from "@agenta/shared/quotes"
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react"
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vitest"

import {
    PreviewCommentLayer,
    type PreviewPick,
    type PreviewPinRect,
} from "../../src/QuoteSelection/PreviewCommentLayer"
import {
    clearQuotes,
    clearSessionQuotes,
    getQuotes,
    registerQuoteSubmit,
} from "../../src/QuoteSelection/store"

const sessionId = "preview-comment-session"
const target = {path: "deck.pptx", displayPath: "agent-files/deck.pptx", fileName: "deck.pptx"}
const anchor: PreviewAnchor = {
    type: "element",
    format: "presentation",
    selector: ":scope > :nth-child(3)",
    tag: "div",
    page: 3,
    point: {x: 0.25, y: 0.5},
}
const rect = {top: 100, left: 40, width: 200, height: 60}
const pick: PreviewPick = {anchor, text: "Q3 revenue grew 40%", rect}

// jsdom has no layout; the layer clips pins to its root's size.
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {configurable: true, value: 800})
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {configurable: true, value: 600})
})

afterAll(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "clientWidth")
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight")
})

afterEach(() => {
    cleanup()
    clearSessionQuotes(sessionId)
})

function setup(touch = true) {
    const rootRef = createRef<HTMLDivElement>()
    const onPickConsumed = vi.fn()
    const ui = (p: PreviewPick | null, pinRects: PreviewPinRect[]) => (
        <div ref={rootRef}>
            <PreviewCommentLayer
                rootRef={rootRef}
                sessionId={sessionId}
                target={target}
                pick={p}
                onPickConsumed={onPickConsumed}
                pinRects={pinRects}
                touch={touch}
            />
        </div>
    )
    const view = render(ui(pick, []))
    return {
        onPickConsumed,
        rerender: (pinRects: PreviewPinRect[]) => view.rerender(ui(null, pinRects)),
        pickAgain: (next: PreviewPick) => view.rerender(ui(next, [])),
    }
}

function typeNote(text: string, modifier?: {ctrlKey: boolean}) {
    const input = within(screen.getByRole("dialog")).getByRole("textbox")
    fireEvent.change(input, {target: {value: text}})
    fireEvent.keyDown(input, {key: "Enter", ...modifier})
}

function stageOne(touch = true) {
    const harness = setup(touch)
    typeNote("Say 41%.")
    const id = getQuotes(sessionId)[0].id
    harness.rerender([{id, rect}])
    return {...harness, id}
}

describe("PreviewCommentLayer", () => {
    it("opens the note at a pick and stages a preview quote on Enter", () => {
        const {onPickConsumed} = setup()
        expect(onPickConsumed).toHaveBeenCalledTimes(1)
        typeNote("Say 41%.")
        expect(screen.queryByRole("dialog")).toBeNull()
        expect(getQuotes(sessionId)).toEqual([
            {
                id: expect.any(String),
                text: "Q3 revenue grew 40%",
                note: "Say 41%.",
                staged: true,
                stale: false,
                source: {kind: "preview", ...target, anchor},
            },
        ])
    })

    it("stages and sends on Ctrl+Enter", () => {
        const submit = vi.fn(() => true)
        const unregister = registerQuoteSubmit(sessionId, submit)
        try {
            setup()
            typeNote("Say 41%.", {ctrlKey: true})
            expect(getQuotes(sessionId)).toHaveLength(1)
            expect(submit).toHaveBeenCalledTimes(1)
        } finally {
            unregister()
        }
    })

    it("discards the draft on Escape", () => {
        setup()
        fireEvent.keyDown(within(screen.getByRole("dialog")).getByRole("textbox"), {key: "Escape"})
        expect(screen.queryByRole("dialog")).toBeNull()
        expect(getQuotes(sessionId)).toEqual([])
    })

    it("pins a staged comment at its point with its number", () => {
        stageOne()
        const pin = screen.getByRole("button", {name: "Comment 1"})
        expect(pin.textContent).toBe("1")
        expect(pin.style.top).toBe("130px")
        expect(pin.style.left).toBe("90px")
    })

    it("opens the pin card on hover, not on click, on a pointer device", () => {
        stageOne(false)
        const pin = screen.getByRole("button", {name: "Comment 1"})
        expect(pin.getAttribute("data-slot")).toBe("hover-card-trigger")
        fireEvent.click(pin)
        expect(screen.queryByRole("button", {name: "Edit"})).toBeNull()
    })

    it("clears the pins once the message is sent", () => {
        const {id, rerender} = stageOne()
        act(() => clearQuotes(sessionId))
        rerender([{id, rect}])
        expect(screen.queryByRole("button", {name: "Comment 1"})).toBeNull()
    })

    it("edits the note from the pin card", () => {
        const {id} = stageOne()
        fireEvent.click(screen.getByRole("button", {name: "Comment 1"}))
        fireEvent.click(screen.getByRole("button", {name: "Edit"}))
        const input = within(screen.getByRole("dialog")).getByRole("textbox")
        expect((input as HTMLTextAreaElement).value).toBe("Say 41%.")
        typeNote("Say 42%.")
        expect(getQuotes(sessionId)).toEqual([
            expect.objectContaining({
                id,
                note: "Say 42%.",
                source: {kind: "preview", ...target, anchor},
            }),
        ])
    })

    it("deletes the comment and its pin from the pin card", () => {
        stageOne()
        fireEvent.click(screen.getByRole("button", {name: "Comment 1"}))
        fireEvent.click(screen.getByRole("button", {name: "Delete"}))
        expect(getQuotes(sessionId)).toEqual([])
        expect(screen.queryByRole("button", {name: "Comment 1"})).toBeNull()
    })

    it("marks a comment stale while its element is gone and hides its pin", () => {
        const {id, rerender} = stageOne()
        act(() => rerender([{id, rect: null}]))
        expect(getQuotes(sessionId)[0].stale).toBe(true)
        expect(screen.queryByRole("button", {name: "Comment 1"})).toBeNull()
        act(() => rerender([{id, rect}]))
        expect(getQuotes(sessionId)[0].stale).toBe(false)
        expect(screen.getByRole("button", {name: "Comment 1"})).toBeTruthy()
    })

    it("hides the pin of an element scrolled out of view without marking it stale", () => {
        const {id, rerender} = stageOne()
        act(() => rerender([{id, rect: {...rect, top: -500}}]))
        expect(getQuotes(sessionId)[0].stale).toBe(false)
        expect(screen.queryByRole("button", {name: "Comment 1"})).toBeNull()
    })

    it("moves an open draft to a second pick and keeps what was typed", () => {
        const {pickAgain} = setup()
        const input = within(screen.getByRole("dialog")).getByRole("textbox")
        fireEvent.change(input, {target: {value: "Half a thought"}})
        const second: PreviewPick = {
            anchor: {...anchor, selector: ":scope > :nth-child(4)"},
            text: "Q4 outlook",
            rect: {...rect, top: 300},
        }
        act(() => pickAgain(second))
        const moved = within(screen.getByRole("dialog")).getByRole("textbox") as HTMLTextAreaElement
        expect(moved.value).toBe("Half a thought")
        expect(moved.selectionStart).toBe("Half a thought".length)
        fireEvent.keyDown(moved, {key: "Enter"})
        expect(getQuotes(sessionId).map((q) => [q.text, q.note])).toEqual([
            ["Q4 outlook", "Half a thought"],
        ])
    })

    it("moves the open draft's note box with its element", () => {
        const {rerender} = setup()
        const [draft] = getQuotes(sessionId)
        expect([draft.staged, draft.text]).toEqual([false, "Q3 revenue grew 40%"])
        const before = screen.getByRole("dialog").style.top
        act(() => rerender([{id: draft.id, rect: {...rect, top: 250}}]))
        expect(screen.getByRole("dialog").style.top).not.toBe(before)
        expect(screen.getByRole("dialog").style.top).toBe(`${250 + rect.height + 8}px`)
    })

    it("drops the unstaged draft when the layer goes away", () => {
        setup()
        expect(getQuotes(sessionId)).toHaveLength(1)
        cleanup()
        expect(getQuotes(sessionId)).toEqual([])
    })

    it("continues an edit after the existing note", () => {
        const {id} = stageOne()
        fireEvent.click(screen.getByRole("button", {name: "Comment 1"}))
        fireEvent.click(screen.getByRole("button", {name: "Edit"}))
        const input = within(screen.getByRole("dialog")).getByRole("textbox") as HTMLTextAreaElement
        expect(input.value).toBe("Say 41%.")
        expect(input.selectionStart).toBe("Say 41%.".length)
        expect(getQuotes(sessionId)[0].id).toBe(id)
    })
})
