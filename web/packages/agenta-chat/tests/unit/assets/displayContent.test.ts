import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"
import {
    displayMessage,
    displayMessageText,
    editedExecutionText,
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
