import type {FileUIPart, UIMessage} from "ai"
import {describe, expect, it} from "vitest"
import {
    displayMessage,
    displayMessageText,
    editedExecutionText,
    outboundUserParts,
} from "../../../src/assets/displayContent"

const source: UIMessage = {
    id: "one",
    role: "user",
    parts: [
        {type: "text", text: "Visible request\nTemplate setup fact: cobalt"},
        {
            type: "file",
            mediaType: "text/plain",
            url: "https://example.test/file",
            filename: "notes.txt",
        },
    ],
}
describe("display content", () => {
    it("keeps legacy message identity", () => expect(displayMessage(source)).toBe(source))
    it.each(["Visible request", ""])("projects %j without mutating execution or files", (text) => {
        const message = {...source, metadata: {display_content: text}}
        expect(displayMessageText(message)).toBe(text)
        expect(displayMessage(message).parts[1]).toBe(source.parts[1])
        expect(message.parts).toBe(source.parts)
        expect(JSON.stringify(message.parts)).toContain("cobalt")
    })
    it("hides every part for explicit null", () => {
        expect(displayMessage({...source, metadata: {display_content: null}}).parts).toEqual([])
    })
})

it("keeps setup once when the visible request is edited", () => {
    const original = {...source, metadata: {display_content: "Visible request"}}
    const edited = editedExecutionText(original, "Revised request")!
    expect(edited.match(/cobalt/g)).toHaveLength(1)
    expect(edited).toContain("Revised request")
    expect(
        displayMessageText({
            ...original,
            parts: [{type: "text", text: edited}],
            metadata: {display_content: "Revised request"},
        }),
    ).toBe("Revised request")
    expect(editedExecutionText(source, "Ordinary edit")).toBeUndefined()
})

describe("outboundUserParts", () => {
    const attachment: FileUIPart = {
        type: "file",
        url: "https://files.test/report.pdf",
        mediaType: "application/pdf",
    }

    // The SDK keeps any text that is not None, so an empty string reaches the model as an empty
    // text content block and Anthropic-family models refuse the turn (v0.119.1 risk map, entry 5).
    it("carries no text part when an attachment-only send has no text", () => {
        expect(outboundUserParts({text: "", fileParts: [attachment]})).toEqual([attachment])
    })

    it("puts the text before the files when there is text", () => {
        expect(outboundUserParts({text: "look at this", fileParts: [attachment]})).toEqual([
            {type: "text", text: "look at this"},
            attachment,
        ])
    })

    it("sends the execution text in place of the displayed one", () => {
        expect(outboundUserParts({text: "shown", executionText: "sent"})).toEqual([
            {type: "text", text: "sent"},
        ])
    })

    it("drops an execution text that is itself empty", () => {
        expect(outboundUserParts({text: "", executionText: "", fileParts: [attachment]})).toEqual([
            attachment,
        ])
    })

    it("carries nothing at all for an empty send", () => {
        expect(outboundUserParts({text: ""})).toEqual([])
    })
})
