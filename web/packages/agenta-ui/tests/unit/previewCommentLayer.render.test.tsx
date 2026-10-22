// @vitest-environment jsdom
import {createRef} from "react"

import type {PreviewAnchor} from "@agenta/shared/quotes"
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

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
})
