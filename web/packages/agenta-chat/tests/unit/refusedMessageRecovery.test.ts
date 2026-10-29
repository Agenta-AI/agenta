import {describe, expect, it, vi} from "vitest"

import {
    canRestoreRefusedSend,
    restoreRefusedDraft,
    restoreHeldRefusedSend,
    restoreRefusedSend,
} from "../../src/assets/refusedMessageRecovery"

describe("restoreRefusedDraft", () => {
    it("waits for the editor's own acknowledgement before reading the text back", async () => {
        // The real editor commits a write later and resolves `setMarkdown` when it has. A read in
        // the calling tick still sees the old document — the "both places" failure (#6697).
        let committed = ""
        let commit: (() => void) | undefined
        const setMarkdown = vi.fn(
            (next: string) =>
                new Promise<void>((resolve) => {
                    commit = () => {
                        committed = next
                        resolve()
                    }
                }),
        )
        const editor = {getMarkdown: () => committed, setMarkdown} as never

        const restored = restoreRefusedDraft(editor, "try again")
        // Not settled while the editor has not committed — no premature "no".
        let settled = false
        void restored.then(() => {
            settled = true
        })
        for (let i = 0; i < 20; i += 1) await Promise.resolve()
        expect(settled).toBe(false)
        commit!()
        expect(await restored).toBe(true)
    })

    it("restores a refused message only into an empty composer", async () => {
        // The stub STORES what it is given, because success is now confirmed by reading it back
        // rather than by the call returning.
        let markdown = ""
        const setMarkdown = vi.fn((next: string) => {
            markdown = next
        })
        const editor = {getMarkdown: () => markdown, setMarkdown} as never

        expect(await restoreRefusedDraft(editor, "try again")).toBe(true)
        expect(setMarkdown).toHaveBeenCalledWith("try again")
    })

    it("does not overwrite a newer draft", async () => {
        const setMarkdown = vi.fn()
        const editor = {getMarkdown: () => "new draft", setMarkdown} as never

        expect(await restoreRefusedDraft(editor, "old refused message")).toBe(false)
        expect(setMarkdown).not.toHaveBeenCalled()
    })

    it("allows attachment recovery only while the composer is still empty", async () => {
        expect(canRestoreRefusedSend({getMarkdown: () => "", setMarkdown: vi.fn()} as never)).toBe(
            true,
        )
        expect(
            canRestoreRefusedSend({getMarkdown: () => "new draft", setMarkdown: vi.fn()} as never),
        ).toBe(false)
    })

    it("leaves a refused send with staged attachments untouched behind a newer draft", async () => {
        const setMarkdown = vi.fn()
        const restoreAttachments = vi.fn()
        const stagedFiles = [{uid: "file-1", name: "brief.pdf"}]
        const editor = {getMarkdown: () => "newer draft", setMarkdown} as never

        expect(
            await restoreRefusedSend(
                editor,
                {text: "refused message", stagedFiles},
                restoreAttachments,
            ),
        ).toBe(false)
        expect(setMarkdown).not.toHaveBeenCalled()
        expect(restoreAttachments).not.toHaveBeenCalled()
    })

    it("captures a refusal before deferred placement and restores it once", async () => {
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
        const frames: (() => Promise<boolean>)[] = []

        expect(slot.current).toBeUndefined()
        if (!slot.current) slot.current = takeLastSent()
        frames.push(() => restoreHeldRefusedSend(slot, editor, restoreAttachments))

        lastSent = newer
        markdown = ""
        await expect(frames.shift()?.()).resolves.toBe(true)

        expect(setMarkdown).toHaveBeenCalledTimes(1)
        expect(setMarkdown).toHaveBeenCalledWith("refused message")
        expect(restoreAttachments).toHaveBeenCalledTimes(1)
        expect(restoreAttachments).toHaveBeenCalledWith(stagedFiles)
        expect(lastSent).toBe(newer)

        expect(await restoreHeldRefusedSend(slot, editor, restoreAttachments)).toBe(false)
        expect(setMarkdown).toHaveBeenCalledTimes(1)
        expect(restoreAttachments).toHaveBeenCalledTimes(1)
    })
})

describe("restoreRefusedSend for a late refusal", () => {
    // A refusal carried inside a 200 arrives seconds after the composer cleared, so unlike a
    // rejected send the user has had time to type something else. These pin the two properties
    // the late path depends on: it never overwrites that, and it says so by returning false, which
    // is what keeps the echo row as the recovery surface in exactly that case.
    it("refuses a composer the user has typed into, and reports it", async () => {
        const editor = {
            getMarkdown: () => "something I typed since",
            setMarkdown: vi.fn(),
        } as unknown as RichChatInputHandle
        const restoreAttachments = vi.fn()

        expect(
            await restoreRefusedSend(
                editor,
                {text: "refused", stagedFiles: []},
                restoreAttachments,
            ),
        ).toBe(false)
        expect(editor.setMarkdown).not.toHaveBeenCalled()
        expect(restoreAttachments).not.toHaveBeenCalled()
    })

    it("puts the staged files back with the text, not the text alone", async () => {
        let markdown = ""
        const editor = {
            getMarkdown: () => markdown,
            setMarkdown: (next: string) => {
                markdown = next
            },
        } as unknown as RichChatInputHandle
        const restoreAttachments = vi.fn()
        const stagedFiles = [{uid: "f1"}]

        expect(
            await restoreRefusedSend(editor, {text: "refused", stagedFiles}, restoreAttachments),
        ).toBe(true)
        expect(markdown).toBe("refused")
        expect(restoreAttachments).toHaveBeenCalledWith(stagedFiles)
    })
})

describe("restoreRefusedDraft with a stale editor handle", () => {
    it("reports failure when setMarkdown silently does nothing", async () => {
        // The handle's setMarkdown returns void and is a no-op once its internal ref is gone.
        // Reporting success there tells the caller the message is safe in the composer when it is
        // nowhere, and the caller uses that to drop the only row showing it.
        const stale = {
            getMarkdown: () => "",
            setMarkdown: () => undefined,
        } as unknown as RichChatInputHandle

        expect(await restoreRefusedDraft(stale, "refused")).toBe(false)
        expect(await restoreRefusedSend(stale, {text: "refused", stagedFiles: []}, vi.fn())).toBe(
            false,
        )
    })
})

/**
 * A refused send that carries files. The caller drops the echo row when the restore reports
 * success, so a false success deletes the only copy of the message — reported against #6658 as
 * "a successful text restore deletes the attachment row and leaves nothing".
 */
describe("restoreRefusedSend for a send carrying attachments", () => {
    const emptyEditor = () => {
        let markdown = ""
        return {
            getMarkdown: () => markdown,
            setMarkdown: vi.fn((next: string) => {
                markdown = next
            }),
        } as never
    }

    it("restores an attachments-only send into the composer and reports success", async () => {
        const restoreAttachments = vi.fn()
        const stagedFiles = [{uid: "file-1", name: "brief.pdf"}]

        expect(
            await restoreRefusedSend(
                emptyEditor(),
                {text: "", stagedFiles, fileParts: [{type: "file"}]},
                restoreAttachments,
            ),
        ).toBe(true)
        expect(restoreAttachments).toHaveBeenCalledWith(stagedFiles)
    })

    it("refuses when the send carried attachments the tray cannot take back", async () => {
        // A merged queue edit or a seed handed over from another surface arrives with file parts
        // and no staged entry behind them. Restoring the words alone would delete the files.
        const restoreAttachments = vi.fn()

        expect(
            await restoreRefusedSend(
                emptyEditor(),
                {text: "with a file", stagedFiles: [], fileParts: [{type: "file"}]},
                restoreAttachments,
            ),
        ).toBe(false)
        expect(restoreAttachments).not.toHaveBeenCalled()
    })

    it("refuses an attachments-only send whose staged entries are gone", async () => {
        // Reporting success here puts nothing anywhere and drops the row with it.
        const restoreAttachments = vi.fn()

        expect(
            await restoreRefusedSend(
                emptyEditor(),
                {text: "", stagedFiles: [], fileParts: [{type: "file"}]},
                restoreAttachments,
            ),
        ).toBe(false)
        expect(restoreAttachments).not.toHaveBeenCalled()
    })

    it("refuses a send with nothing in it at all", async () => {
        expect(await restoreRefusedSend(emptyEditor(), {text: ""}, vi.fn())).toBe(false)
    })

    it("still treats the staged entries as the whole send when no file parts are given", async () => {
        const restoreAttachments = vi.fn()
        const stagedFiles = [{uid: "file-1", name: "brief.pdf"}]

        expect(
            await restoreRefusedSend(emptyEditor(), {text: "", stagedFiles}, restoreAttachments),
        ).toBe(true)
        expect(restoreAttachments).toHaveBeenCalledWith(stagedFiles)
    })
})

describe("restoreHeldRefusedSend has no row to fall back on", () => {
    const emptyEditor = () => {
        let markdown = ""
        return {
            getMarkdown: () => markdown,
            setMarkdown: vi.fn((next: string) => {
                markdown = next
            }),
        } as never
    }

    it("places what it can when the send carried files the tray cannot take back", async () => {
        // The early rejection already dropped the echo row, so refusing here would leave the
        // message in no visible place at all. The words go back; the files are already lost.
        const restoreAttachments = vi.fn()
        const slot = {
            current: {text: "with a file", stagedFiles: [], fileParts: [{type: "file"}]} as never,
        }
        const editor = emptyEditor()

        expect(await restoreHeldRefusedSend(slot, editor, restoreAttachments)).toBe(true)
        expect(slot.current).toBeUndefined()
    })

    it("still keeps the send held behind a newer draft", async () => {
        const slot = {current: {text: "refused", stagedFiles: []} as never}
        const editor = {getMarkdown: () => "newer draft", setMarkdown: vi.fn()} as never

        expect(await restoreHeldRefusedSend(slot, editor, vi.fn())).toBe(false)
        expect(slot.current).toBeDefined()
    })
})

/**
 * The live defect, at the helper. The desktop composer is Lexical, and `setMarkdown` schedules the
 * write rather than applying it, so reading the editor back in the calling tick answers "no" for a
 * placement that is on its way. The caller keeps the flagged row on that answer, and the text turns
 * up in the composer a moment later, so the same message is in both places and can be sent twice.
 * Reproduced on staging at `66ed5a6c57` on /w with a refusal arriving as a 200 whose stream errors.
 */
describe("restoreRefusedSend against a composer that commits late", () => {
    /** Applies `setMarkdown` after `commitAfter` microtask turns, the way Lexical batches. */
    const lateEditor = (commitAfter: number) => {
        let markdown = ""
        return {
            getMarkdown: () => markdown,
            setMarkdown: vi.fn((next: string) => {
                let turns = commitAfter
                const apply = () => {
                    if (turns > 0) {
                        turns -= 1
                        void Promise.resolve().then(apply)
                        return
                    }
                    markdown = next
                }
                void Promise.resolve().then(apply)
            }),
        } as never
    }

    it("reports the restore once the composer commits a tick later", async () => {
        const restoreAttachments = vi.fn()

        await expect(
            restoreRefusedSend(lateEditor(1), {text: "refused message"}, restoreAttachments),
        ).resolves.toBe(true)
    })

    it("reports it for a composer that takes several turns to commit", async () => {
        await expect(
            restoreRefusedSend(lateEditor(6), {text: "refused message"}, vi.fn()),
        ).resolves.toBe(true)
    })

    it("still reports failure for a composer that never takes the text", async () => {
        const editor = {getMarkdown: () => "", setMarkdown: vi.fn()} as never

        await expect(restoreRefusedSend(editor, {text: "refused"}, vi.fn())).resolves.toBe(false)
    })

    it("restores the attachments only after the words are confirmed", async () => {
        // Putting the files back before the composer has taken the words would leave the tray and
        // the row holding the same attachment.
        const restoreAttachments = vi.fn()
        const stagedFiles = [{uid: "file-1", name: "brief.pdf"}]

        const pending = restoreRefusedSend(
            lateEditor(3),
            {text: "with a file", stagedFiles},
            restoreAttachments,
        )
        expect(restoreAttachments).not.toHaveBeenCalled()

        await expect(pending).resolves.toBe(true)
        expect(restoreAttachments).toHaveBeenCalledWith(stagedFiles)
    })
})
