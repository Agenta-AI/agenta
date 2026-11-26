import {quotesToMarkdown, type Quote} from "@agenta/shared/quotes"
import {describe, expect, it} from "vitest"

import {quotedMessageParts} from "@/features/chat/quotedMessageParts"

const fileQuote = (path: string, text: string, note = ""): Quote =>
    ({id: path, text, note, source: {kind: "file", path}}) as Quote

describe("quotedMessageParts", () => {
    it("keeps each quote next to its note, then the message", () => {
        const markdown = quotesToMarkdown(
            [fileQuote("memo.docx", "Revenue grew", "Name the regions."), fileQuote("a.md", "Hi")],
            "Reply in one line.",
        )
        expect(quotedMessageParts(markdown)).toEqual([
            {kind: "quote", quote: {origin: "memo.docx", text: "Revenue grew"}},
            {kind: "text", text: "Name the regions."},
            {kind: "quote", quote: {origin: "a.md", text: "Hi"}},
            {kind: "text", text: "Reply in one line."},
        ])
    })

    it("reads a message without quotes as one text part", () => {
        expect(quotedMessageParts("Just text\n\nTwo paragraphs")).toEqual([
            {kind: "text", text: "Just text\n\nTwo paragraphs"},
        ])
    })
})
