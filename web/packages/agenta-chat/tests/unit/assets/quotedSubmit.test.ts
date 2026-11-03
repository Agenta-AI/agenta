import type {Quote} from "@agenta/shared/quotes"
import {clearQuotes, getQuotes, restoreQuotes} from "@agenta/ui/quote-selection"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {afterEach, describe, expect, it, vi} from "vitest"

import {withStagedQuotes} from "../../../src/assets/quotedSubmit"

const SESSION = "quoted-submit-session"
const quote: Quote = {
    id: "q1",
    text: "the excerpt",
    note: "",
    staged: true,
    stale: false,
    source: {kind: "message", messageId: "m1"},
}
const editor = (markdown: string) =>
    ({getMarkdown: () => markdown, setMarkdown: vi.fn()}) as unknown as RichChatInputHandle

afterEach(() => clearQuotes(SESSION))

describe("withStagedQuotes", () => {
    it("returns a synchronous refusal as false and gives the chips back", () => {
        restoreQuotes(SESSION, [quote])
        const result = withStagedQuotes(
            SESSION,
            () => false,
            () => editor("typed"),
        )("typed")
        expect(result).toBe(false)
        expect(getQuotes(SESSION)).toEqual([quote])
    })

    it("restores the chips and the text after a later refusal into an empty editor", async () => {
        restoreQuotes(SESSION, [quote])
        const input = editor("")
        await withStagedQuotes(
            SESSION,
            async () => false,
            () => input,
        )("typed")
        expect(getQuotes(SESSION)).toEqual([quote])
        expect(input.setMarkdown).toHaveBeenCalledWith("typed")
    })

    it("leaves a newer draft alone after a later refusal", async () => {
        restoreQuotes(SESSION, [quote])
        const input = editor("a newer draft")
        await withStagedQuotes(
            SESSION,
            async () => false,
            () => input,
        )("typed")
        expect(input.setMarkdown).not.toHaveBeenCalled()
    })

    it("restores the chips when the send rejects, and still rejects", async () => {
        restoreQuotes(SESSION, [quote])
        const input = editor("")
        const sent = withStagedQuotes(
            SESSION,
            async () => {
                throw new Error("boom")
            },
            () => input,
        )("typed")
        await expect(sent).rejects.toThrow("boom")
        expect(getQuotes(SESSION)).toEqual([quote])
        expect(input.setMarkdown).toHaveBeenCalledWith("typed")
    })

    it("consumes the chips when the send goes out", async () => {
        restoreQuotes(SESSION, [quote])
        const send = vi.fn(async () => true)
        await withStagedQuotes(SESSION, send, () => editor(""))("typed")
        expect(send).toHaveBeenCalledWith(expect.stringContaining("the excerpt"))
        expect(getQuotes(SESSION)).toEqual([])
    })
})
