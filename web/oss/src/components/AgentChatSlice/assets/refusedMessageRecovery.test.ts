import {describe, expect, it, vi} from "vitest"

import {
    canRestoreRefusedSend,
    restoreRefusedDraft,
    restoreRefusedSend,
} from "./refusedMessageRecovery"

describe("restoreRefusedDraft", () => {
    it("restores a refused message only into an empty composer", () => {
        const setMarkdown = vi.fn()
        const editor = {getMarkdown: () => "", setMarkdown} as never

        expect(restoreRefusedDraft(editor, "try again")).toBe(true)
        expect(setMarkdown).toHaveBeenCalledWith("try again")
    })

    it("does not overwrite a newer draft", () => {
        const setMarkdown = vi.fn()
        const editor = {getMarkdown: () => "new draft", setMarkdown} as never

        expect(restoreRefusedDraft(editor, "old refused message")).toBe(false)
        expect(setMarkdown).not.toHaveBeenCalled()
    })

    it("allows attachment recovery only while the composer is still empty", () => {
        expect(canRestoreRefusedSend({getMarkdown: () => "", setMarkdown: vi.fn()} as never)).toBe(
            true,
        )
        expect(
            canRestoreRefusedSend({getMarkdown: () => "new draft", setMarkdown: vi.fn()} as never),
        ).toBe(false)
    })

    it("leaves a refused send with staged attachments untouched behind a newer draft", () => {
        const setMarkdown = vi.fn()
        const restoreAttachments = vi.fn()
        const stagedFiles = [{uid: "file-1", name: "brief.pdf"}]
        const editor = {getMarkdown: () => "newer draft", setMarkdown} as never

        expect(
            restoreRefusedSend(editor, {text: "refused message", stagedFiles}, restoreAttachments),
        ).toBe(false)
        expect(setMarkdown).not.toHaveBeenCalled()
        expect(restoreAttachments).not.toHaveBeenCalled()
    })
})
