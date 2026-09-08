import {describe, expect, it, vi} from "vitest"

import {
    canRestoreRefusedSend,
    restoreRefusedDraft,
    restoreHeldRefusedSend,
    restoreRefusedSend,
} from "./refusedMessageRecovery"

describe("restoreRefusedDraft", () => {
    it("restores a refused message only into an empty composer", () => {
        // The stub STORES what it is given, because success is now confirmed by reading it back
        // rather than by the call returning.
        let markdown = ""
        const setMarkdown = vi.fn((next: string) => {
            markdown = next
        })
        const editor = {getMarkdown: () => markdown, setMarkdown} as never

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

describe("restoreRefusedSend for a late refusal", () => {
    // A refusal carried inside a 200 arrives seconds after the composer cleared, so unlike a
    // rejected send the user has had time to type something else. These pin the two properties
    // the late path depends on: it never overwrites that, and it says so by returning false, which
    // is what keeps the echo row as the recovery surface in exactly that case.
    it("refuses a composer the user has typed into, and reports it", () => {
        const editor = {
            getMarkdown: () => "something I typed since",
            setMarkdown: vi.fn(),
        } as unknown as RichChatInputHandle
        const restoreAttachments = vi.fn()

        expect(
            restoreRefusedSend(editor, {text: "refused", stagedFiles: []}, restoreAttachments),
        ).toBe(false)
        expect(editor.setMarkdown).not.toHaveBeenCalled()
        expect(restoreAttachments).not.toHaveBeenCalled()
    })

    it("puts the staged files back with the text, not the text alone", () => {
        let markdown = ""
        const editor = {
            getMarkdown: () => markdown,
            setMarkdown: (next: string) => {
                markdown = next
            },
        } as unknown as RichChatInputHandle
        const restoreAttachments = vi.fn()
        const stagedFiles = [{uid: "f1"}]

        expect(restoreRefusedSend(editor, {text: "refused", stagedFiles}, restoreAttachments)).toBe(
            true,
        )
        expect(markdown).toBe("refused")
        expect(restoreAttachments).toHaveBeenCalledWith(stagedFiles)
    })
})

describe("restoreRefusedDraft with a stale editor handle", () => {
    it("reports failure when setMarkdown silently does nothing", () => {
        // The handle's setMarkdown returns void and is a no-op once its internal ref is gone.
        // Reporting success there tells the caller the message is safe in the composer when it is
        // nowhere, and the caller uses that to drop the only row showing it.
        const stale = {
            getMarkdown: () => "",
            setMarkdown: () => undefined,
        } as unknown as RichChatInputHandle

        expect(restoreRefusedDraft(stale, "refused")).toBe(false)
        expect(restoreRefusedSend(stale, {text: "refused", stagedFiles: []}, vi.fn())).toBe(false)
    })
})
