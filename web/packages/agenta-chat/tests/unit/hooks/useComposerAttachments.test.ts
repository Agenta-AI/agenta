// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {DEFAULT_ATTACHMENT_LIMITS} from "../../../src/assets/attachmentRules"
import {useComposerAttachments} from "../../../src/hooks/useComposerAttachments"
import {attachmentsBySession} from "../../../src/state/sessionEphemera"

const makeFile = (name: string, type = "text/plain", size = 16): File => {
    const blob = new Uint8Array(size).fill(97)
    return new File([blob], name, {type, lastModified: 1_700_000_000_000})
}

// `uploadsEnabled: false` keeps every test off the network: files stage as settled ("done")
// without the multipart upload lifecycle.
const setup = (sessionId = `attach-${Math.random().toString(36).slice(2)}`) => ({
    sessionId,
    ...renderHook(() => useComposerAttachments({sessionId, uploadsEnabled: false})),
})

afterEach(() => {
    attachmentsBySession.clear()
})

describe("useComposerAttachments", () => {
    it("stages accepted files settled, with the tray uid minted once and no rejections", () => {
        const {result} = setup()
        act(() => {
            result.current.addFiles([makeFile("notes.txt")])
        })
        expect(result.current.files).toHaveLength(1)
        expect(result.current.files[0].name).toBe("notes.txt")
        expect(result.current.files[0].uid).toMatch(/^att-/)
        expect(result.current.files[0].status).toBe("done")
        expect(result.current.attachmentsSettled).toBe(true)
        expect(result.current.rejections).toHaveLength(0)
        expect(result.current.atMax).toBe(false)
    })

    it("rejects oversized files with a per-file reason and stages the rest", () => {
        const {result} = setup()
        act(() => {
            result.current.addFiles([
                makeFile("huge.txt", "text/plain", DEFAULT_ATTACHMENT_LIMITS.maxBytes.document + 1),
                makeFile("ok.txt"),
            ])
        })
        expect(result.current.files.map((f) => f.name)).toEqual(["ok.txt"])
        expect(result.current.rejections.map((r) => r.name)).toEqual(["huge.txt"])
        // A rejection opens the tray so the message is visible.
        expect(result.current.attachmentsOpen).toBe(true)
    })

    it("caps the staged set at the count limit and flags atMax", () => {
        const {result} = setup()
        const batch = Array.from({length: DEFAULT_ATTACHMENT_LIMITS.maxCount + 2}, (_, i) =>
            makeFile(`f${i}.txt`),
        )
        act(() => {
            result.current.addFiles(batch)
        })
        expect(result.current.files).toHaveLength(DEFAULT_ATTACHMENT_LIMITS.maxCount)
        expect(result.current.atMax).toBe(true)
        expect(result.current.rejections).toHaveLength(2)
        act(() => {
            result.current.addFiles([makeFile("extra.txt")])
        })
        expect(result.current.files).toHaveLength(DEFAULT_ATTACHMENT_LIMITS.maxCount)
        expect(result.current.rejections.map((r) => r.name)).toEqual(["extra.txt"])
    })

    // A paste and a drop can both fire before React re-renders. Reading the count from the
    // render closure would make both batches see zero staged files and blow past the cap.
    it("holds the count limit across two adds in the same tick", () => {
        const {result} = setup()
        const half = Math.ceil(DEFAULT_ATTACHMENT_LIMITS.maxCount / 2) + 1
        const batch = (tag: string) =>
            Array.from({length: half}, (_, i) => makeFile(`${tag}${i}.txt`))
        act(() => {
            result.current.addFiles(batch("a"))
            result.current.addFiles(batch("b"))
        })
        expect(result.current.files.length).toBeLessThanOrEqual(DEFAULT_ATTACHMENT_LIMITS.maxCount)
        expect(result.current.atMax).toBe(true)
    })

    it("persists staged files per session across a remount, keyed by session id", () => {
        const sessionId = `attach-restore-${Date.now()}`
        const first = setup(sessionId)
        act(() => {
            first.result.current.addFiles([makeFile("keep.txt")])
        })
        first.unmount()
        expect(attachmentsBySession.get(sessionId)).toHaveLength(1)
        const second = setup(sessionId)
        expect(second.result.current.files.map((f) => f.name)).toEqual(["keep.txt"])
        const other = setup(`${sessionId}-other`)
        expect(other.result.current.files).toHaveLength(0)
        // Removing the last file empties the per-session store too.
        act(() => {
            second.result.current.removeFile(second.result.current.files[0].uid)
        })
        expect(attachmentsBySession.has(sessionId)).toBe(false)
    })

    it("removeFile unstages one; dismissing rejections keeps files; clearAttachments drops only consumed uids", () => {
        const {result} = setup()
        act(() => {
            result.current.addFiles([
                makeFile("a.txt"),
                makeFile("b.txt"),
                makeFile("huge.txt", "text/plain", DEFAULT_ATTACHMENT_LIMITS.maxBytes.document + 1),
            ])
        })
        expect(result.current.files).toHaveLength(2)
        expect(result.current.rejections).toHaveLength(1)
        act(() => {
            result.current.removeFile(result.current.files[0].uid)
        })
        expect(result.current.files.map((f) => f.name)).toEqual(["b.txt"])
        act(() => {
            result.current.setRejections([])
        })
        expect(result.current.rejections).toHaveLength(0)
        expect(result.current.files).toHaveLength(1)
        act(() => {
            result.current.clearAttachments(result.current.files.map((f) => f.uid))
        })
        expect(result.current.files).toHaveLength(0)
        expect(result.current.attachmentsOpen).toBe(false)
    })
})
