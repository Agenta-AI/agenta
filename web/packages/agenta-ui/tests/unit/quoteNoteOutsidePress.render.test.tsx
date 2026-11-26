// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {pressClosedNote, QuoteNote} from "../../src/QuoteSelection/QuoteNote"

afterEach(cleanup)

const quote = {
    id: "q1",
    text: "Q3 revenue grew 40%",
    note: "",
    staged: false,
    stale: false,
    source: {kind: "message" as const, messageId: "m1"},
}

// jsdom has no PointerEvent; a MouseEvent named pointerdown reaches the same listener.
describe("QuoteNote outside press", () => {
    it("cancels on a press outside and marks that press as the one that closed it", () => {
        const onCancel = vi.fn()
        render(
            <QuoteNote
                quote={quote}
                anchor={{top: 0, left: 0, bottom: 10}}
                bounds={{width: 400, height: 400}}
                onStage={vi.fn()}
                onSend={vi.fn()}
                onCancel={onCancel}
            />,
        )
        const inside = new MouseEvent("pointerdown", {bubbles: true})
        document.querySelector("textarea")!.dispatchEvent(inside)
        expect(onCancel).not.toHaveBeenCalled()
        expect(pressClosedNote(inside)).toBe(false)

        const outside = new MouseEvent("pointerdown", {bubbles: true})
        document.body.dispatchEvent(outside)
        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(pressClosedNote(outside)).toBe(true)
    })
})
