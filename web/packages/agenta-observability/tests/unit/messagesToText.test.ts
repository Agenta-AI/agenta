import {describe, expect, it} from "vitest"

import {messagesToText} from "../../src/traceDrawer/messagePanels"

describe("messagesToText", () => {
    it("renders a chat message array as role headings and content", () => {
        const text = messagesToText([
            {role: "user", content: "Hi"},
            {role: "assistant", content: [{type: "text", text: "Hello there"}]},
        ])
        expect(text).toBe("**User**\n\nHi\n\n**Assistant**\n\nHello there")
    })

    it("reads a JSON string that holds messages", () => {
        expect(messagesToText(JSON.stringify([{role: "assistant", content: "Done"}]))).toBe(
            "**Assistant**\n\nDone",
        )
    })

    it("returns null for a value with no messages", () => {
        expect(messagesToText({answer: 42})).toBeNull()
        expect(messagesToText("plain text")).toBeNull()
    })
})

describe("messagesToText in the plain text view", () => {
    it("labels roles without markdown", () => {
        expect(messagesToText([{role: "user", content: "Hi"}], {markdown: false})).toBe(
            "User\n\nHi",
        )
    })
})
