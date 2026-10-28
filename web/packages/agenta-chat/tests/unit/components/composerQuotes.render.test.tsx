// @vitest-environment jsdom
import type {Quote} from "@agenta/shared/quotes"
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import ComposerQuotes from "../../../src/components/ComposerQuotes"

afterEach(cleanup)

const comment: Quote = {
    id: "c1",
    text: "Q3 revenue grew 40%",
    note: "Say 41%.",
    staged: true,
    stale: false,
    source: {
        kind: "preview",
        path: "deck.pptx",
        displayPath: "agent-files/deck.pptx",
        fileName: "deck.pptx",
        anchor: {
            type: "element",
            format: "presentation",
            selector: ":scope > :nth-child(3)",
            tag: "div",
            page: 3,
            point: {x: 0.5, y: 0.5},
        },
    },
}

const textQuote: Quote = {
    id: "t1",
    text: "A schedule runs one pinned revision.",
    note: "",
    staged: true,
    stale: false,
    source: {
        kind: "file",
        path: "docs/schedule.mdx",
        displayPath: "agent-files/docs/schedule.mdx",
        fileName: "schedule.mdx",
        startLine: 34,
        endLine: 36,
    },
}

describe("ComposerQuotes", () => {
    it("shows each chip's location", () => {
        render(<ComposerQuotes quotes={[comment, textQuote]} onRemove={vi.fn()} />)
        expect(
            Array.from(document.querySelectorAll("[data-quote-range]")).map((el) => el.textContent),
        ).toEqual(["slide 3", "L34–L36"])
    })

    it("edits a preview comment's note from its chip", () => {
        const onEdit = vi.fn()
        render(<ComposerQuotes quotes={[comment]} onRemove={vi.fn()} onEdit={onEdit} />)
        fireEvent.click(screen.getByRole("button", {name: "Edit comment"}))
        const input = screen.getByRole("textbox", {name: "Edit comment"})
        expect((input as HTMLTextAreaElement).value).toBe("Say 41%.")
        fireEvent.change(input, {target: {value: "Say 42%."}})
        fireEvent.keyDown(input, {key: "Enter"})
        expect(onEdit).toHaveBeenCalledWith("c1", "Say 42%.")
        expect(screen.queryByRole("textbox", {name: "Edit comment"})).toBeNull()
    })

    it("opens no editor for a text quote's chip", () => {
        const onEdit = vi.fn()
        render(<ComposerQuotes quotes={[textQuote]} onRemove={vi.fn()} onEdit={onEdit} />)
        expect(screen.queryByRole("button", {name: "Edit comment"})).toBeNull()
        fireEvent.click(screen.getByText("A schedule runs one pinned revision."))
        expect(screen.queryByRole("textbox")).toBeNull()
        expect(onEdit).not.toHaveBeenCalled()
    })

    it("shows a reply quote's note on its chip, the excerpt on hover", () => {
        const replyQuote: Quote = {
            id: "m1",
            text: "The run failed on step 3.",
            note: "Why did it fail?",
            staged: true,
            stale: false,
            source: {kind: "message", messageId: "msg-1"},
        }
        render(<ComposerQuotes quotes={[replyQuote]} onRemove={vi.fn()} />)
        const label = screen.getByText("Why did it fail?")
        expect(screen.queryByText("The run failed on step 3.")).toBeNull()
        expect(label.closest("[title]")?.getAttribute("title")).toBe("The run failed on step 3.")
    })

    it("shows a file quote's note beside its location", () => {
        render(
            <ComposerQuotes
                quotes={[{...textQuote, note: "Is this still true?"}]}
                onRemove={vi.fn()}
            />,
        )
        expect(screen.getByText("Is this still true?")).toBeTruthy()
        expect(screen.getByText("schedule.mdx")).toBeTruthy()
        expect(document.querySelector("[data-quote-range]")?.textContent).toBe("L34–L36")
    })

    it("labels preview chips with their pin numbers per document", () => {
        const second = {...comment, id: "c2"}
        render(<ComposerQuotes quotes={[comment, textQuote, second]} onRemove={vi.fn()} />)
        expect(screen.getByLabelText("Comment 1").textContent).toBe("1")
        expect(screen.getByLabelText("Comment 2").textContent).toBe("2")
        expect(screen.queryByLabelText("Comment 3")).toBeNull()
    })
})
