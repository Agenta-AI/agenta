// @vitest-environment jsdom
import {createRef} from "react"

import type {PreviewAnchor} from "@agenta/shared/quotes"
import {act, cleanup, fireEvent, render, renderHook, screen, within} from "@testing-library/react"
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vitest"

import {
    PreviewCommentLayer,
    type PreviewPick,
    type PreviewPinRect,
} from "../../src/QuoteSelection/PreviewCommentLayer"
import {
    addQuote,
    clearQuoteReveal,
    clearQuotes,
    clearSessionQuotes,
    getQuotes,
    registerQuoteSubmit,
    revealQuote,
    useQuoteReveal,
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

function setup(touch = false) {
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

function stageOne(touch = false) {
    const harness = setup(touch)
    if (touch) {
        const input = within(screen.getByRole("dialog")).getByRole("textbox")
        fireEvent.change(input, {target: {value: "Say 41%."}})
        fireEvent.click(screen.getByRole("button", {name: "Add to message"}))
    } else {
        typeNote("Say 41%.")
    }
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

    it("edits the note from the pin's sheet on a touch screen", () => {
        const {id} = stageOne(true)
        fireEvent.click(screen.getByRole("button", {name: "Comment 1"}))
        fireEvent.click(screen.getByRole("button", {name: "Edit"}))
        const input = within(screen.getByRole("dialog")).getByRole("textbox")
        expect((input as HTMLTextAreaElement).value).toBe("Say 41%.")
        fireEvent.change(input, {target: {value: "Say 42%."}})
        fireEvent.click(screen.getByRole("button", {name: "Save"}))
        expect(getQuotes(sessionId)).toEqual([
            expect.objectContaining({
                id,
                note: "Say 42%.",
                source: {kind: "preview", ...target, anchor},
            }),
        ])
    })

    it("deletes the comment and its pin from the pin's sheet on a touch screen", () => {
        stageOne(true)
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

    it("closes the draft when the session changes under it", () => {
        const rootRef = createRef<HTMLDivElement>()
        const ui = (session: string, p: PreviewPick | null) => (
            <div ref={rootRef}>
                <PreviewCommentLayer
                    rootRef={rootRef}
                    sessionId={session}
                    target={target}
                    pick={p}
                    onPickConsumed={() => {}}
                    pinRects={[]}
                />
            </div>
        )
        const view = render(ui(sessionId, pick))
        expect(screen.getByRole("dialog")).toBeTruthy()
        view.rerender(ui("other-session", null))
        expect(screen.queryByRole("dialog")).toBeNull()
        expect(getQuotes(sessionId)).toEqual([])
        expect(getQuotes("other-session")).toEqual([])
    })

    it("continues an edit after the existing note", () => {
        const {id} = stageOne(true)
        fireEvent.click(screen.getByRole("button", {name: "Comment 1"}))
        fireEvent.click(screen.getByRole("button", {name: "Edit"}))
        const input = within(screen.getByRole("dialog")).getByRole("textbox") as HTMLTextAreaElement
        expect(input.value).toBe("Say 41%.")
        expect(input.selectionStart).toBe("Say 41%.".length)
        expect(getQuotes(sessionId)[0].id).toBe(id)
    })

    it("opens a bottom sheet with Add to message and Send now on a touch screen", () => {
        const submit = vi.fn(() => true)
        const unregister = registerQuoteSubmit(sessionId, submit)
        try {
            setup(true)
            const sheet = screen.getByRole("dialog")
            expect(sheet.getAttribute("data-side")).toBe("bottom")
            fireEvent.change(within(sheet).getByRole("textbox"), {target: {value: "Say 41%."}})
            fireEvent.click(screen.getByRole("button", {name: "Send now"}))
            expect(getQuotes(sessionId).map((q) => [q.note, q.staged])).toEqual([
                ["Say 41%.", true],
            ])
            expect(submit).toHaveBeenCalledTimes(1)
        } finally {
            unregister()
        }
    })

    it("gives a touch pin a 44px hit area around its 28px badge", () => {
        stageOne(true)
        const pin = screen.getByRole("button", {name: "Comment 1"})
        // 28px badge + 8px each side = 44px.
        expect(pin.className).toContain("h-7 min-w-7")
        expect(pin.className).toContain("after:-inset-2")
    })
})

describe("PreviewCommentLayer: reveal, dismiss and mode", () => {
    const getQuoteRevealForTest = () => renderHook(() => useQuoteReveal(sessionId)).result.current
    const staged = (id: string, stale = false) => ({
        id,
        text: "Q3 revenue grew 40%",
        note: "Say 41%.",
        staged: true,
        stale,
        source: {kind: "preview" as const, ...target, anchor},
    })

    const mount = (props: {
        pick?: PreviewPick | null
        pinRects?: PreviewPinRect[]
        dismissSignal?: number
        commenting?: boolean
        onRevealPin?: () => void
        onNoteChange?: (open: boolean) => void
    }) => {
        const rootRef = createRef<HTMLDivElement>()
        const ui = (next: typeof props) => (
            <div ref={rootRef}>
                <PreviewCommentLayer
                    rootRef={rootRef}
                    sessionId={sessionId}
                    target={target}
                    pick={next.pick ?? null}
                    onPickConsumed={() => {}}
                    pinRects={next.pinRects ?? []}
                    dismissSignal={next.dismissSignal}
                    commenting={next.commenting}
                    onRevealPin={next.onRevealPin}
                    onNoteChange={next.onNoteChange}
                    touch
                />
            </div>
        )
        const view = render(ui(props))
        return (next: typeof props) => view.rerender(ui(next))
    }

    afterEach(() => {
        const reveal = getQuoteRevealForTest()
        if (reveal) clearQuoteReveal(sessionId, reveal.seq)
    })

    it("opens the pin card of a revealed comment once its pin is on screen", () => {
        act(() => addQuote(sessionId, staged("c1")))
        const onRevealPin = vi.fn()
        const update = mount({onRevealPin})
        act(() => revealQuote(sessionId, "c1"))
        expect(onRevealPin).toHaveBeenCalledTimes(1)
        update({onRevealPin, pinRects: [{id: "c1", rect}]})
        expect(screen.getByRole("button", {name: "Delete"})).toBeTruthy()
        expect(getQuoteRevealForTest()).toBeNull()
    })

    it("clears the request for a changed comment instead of opening it later", () => {
        act(() => addQuote(sessionId, staged("c1", true)))
        mount({pinRects: [{id: "c1", rect: null}]})
        act(() => revealQuote(sessionId, "c1"))
        expect(getQuoteRevealForTest()).toBeNull()
        expect(screen.queryByRole("button", {name: "Delete"})).toBeNull()
    })

    it("discards an open draft when a comment is revealed", () => {
        act(() => addQuote(sessionId, staged("c1")))
        mount({pick, pinRects: [{id: "c1", rect}]})
        expect(getQuotes(sessionId)).toHaveLength(2)
        act(() => revealQuote(sessionId, "c1"))
        expect(getQuotes(sessionId).map((q) => q.id)).toEqual(["c1"])
    })

    it("closes the draft on a dismiss signal and when comment mode turns off", () => {
        const onNoteChange = vi.fn()
        const update = mount({pick, commenting: true, onNoteChange})
        expect(onNoteChange).toHaveBeenLastCalledWith(true)
        update({commenting: true, dismissSignal: 1, onNoteChange})
        expect(getQuotes(sessionId)).toEqual([])
        expect(onNoteChange).toHaveBeenLastCalledWith(false)
        update({pick: {...pick, text: "again"}, commenting: true, onNoteChange})
        expect(screen.getByRole("dialog")).toBeTruthy()
        update({commenting: false, onNoteChange})
        expect(screen.queryByRole("dialog")).toBeNull()
    })
})
