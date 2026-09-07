import {describe, expect, it, vi} from "vitest"

import {
    canRestoreRefusedSend,
    restoreRefusedDraft,
    restoreHeldRefusedSend,
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

    it("captures a refusal before deferred placement and restores it once", () => {
        let markdown = "newer draft"
        const setMarkdown = vi.fn((next: string) => {
            markdown = next
        })
        const restoreAttachments = vi.fn()
        const stagedFiles = [{uid: "file-1", name: "brief.pdf"}]
        const refused = {text: "refused message", stagedFiles}
        const newer = {text: "newer draft", stagedFiles: []}
        let lastSent: typeof refused | undefined = refused
        const takeLastSent = () => {
            const sent = lastSent
            lastSent = undefined
            return sent
        }
        const slot: {current: typeof refused | undefined} = {current: undefined}
        const editor = {getMarkdown: () => markdown, setMarkdown} as never
        const frames: (() => boolean)[] = []

        expect(slot.current).toBeUndefined()
        if (!slot.current) slot.current = takeLastSent()
        frames.push(() => restoreHeldRefusedSend(slot, editor, restoreAttachments))

        lastSent = newer
        markdown = ""
        expect(frames.shift()?.()).toBe(true)

        expect(setMarkdown).toHaveBeenCalledTimes(1)
        expect(setMarkdown).toHaveBeenCalledWith("refused message")
        expect(restoreAttachments).toHaveBeenCalledTimes(1)
        expect(restoreAttachments).toHaveBeenCalledWith(stagedFiles)
        expect(lastSent).toBe(newer)

        expect(restoreHeldRefusedSend(slot, editor, restoreAttachments)).toBe(false)
        expect(setMarkdown).toHaveBeenCalledTimes(1)
        expect(restoreAttachments).toHaveBeenCalledTimes(1)
    })
})
