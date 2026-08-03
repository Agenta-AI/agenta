// @vitest-environment jsdom
import {act, renderHook, waitFor} from "@testing-library/react"
import {describe, expect, it} from "vitest"

import {DEFAULT_ATTACHMENT_LIMITS} from "../../../src/assets/attachmentRules"
import {
    useComposerAttachments,
    type UseComposerAttachmentsArgs,
} from "../../../src/hooks/useComposerAttachments"
import {attachmentsBySession} from "../../../src/state/sessionEphemera"

const makeFile = (name: string, type = "text/plain", size = 16): File => {
    const blob = new Uint8Array(size).fill(97)
    return new File([blob], name, {type, lastModified: 1_700_000_000_000})
}

const setup = (args: UseComposerAttachmentsArgs = {}) =>
    renderHook((props: UseComposerAttachmentsArgs) => useComposerAttachments(props), {
        initialProps: args,
    })

describe("useComposerAttachments", () => {
    it("stages accepted files with the shared dedup uid and no rejections", () => {
        const {result} = setup()
        act(() => {
            result.current.add([makeFile("notes.txt")])
        })
        expect(result.current.files).toHaveLength(1)
        expect(result.current.files[0].name).toBe("notes.txt")
        expect(result.current.files[0].uid).toBe("notes.txt-1700000000000-16")
        expect(result.current.rejections).toHaveLength(0)
        expect(result.current.atMax).toBe(false)
    })

    it("rejects unsupported types and oversized files with a per-file reason", () => {
        const {result} = setup()
        act(() => {
            result.current.add([
                makeFile("clip.mp4", "video/mp4"),
                makeFile("huge.txt", "text/plain", DEFAULT_ATTACHMENT_LIMITS.maxBytes + 1),
                makeFile("ok.txt"),
            ])
        })
        expect(result.current.files.map((f) => f.name)).toEqual(["ok.txt"])
        expect(result.current.rejections.map((r) => r.name)).toEqual(["clip.mp4", "huge.txt"])
        expect(result.current.rejections[0].reason).toContain("supported file type")
        expect(result.current.rejections[1].reason).toContain("too large")
    })

    it("caps the staged set at the count limit and flags atMax", () => {
        const {result} = setup()
        const batch = Array.from({length: DEFAULT_ATTACHMENT_LIMITS.maxCount + 2}, (_, i) =>
            makeFile(`f${i}.txt`),
        )
        act(() => {
            result.current.add(batch)
        })
        expect(result.current.files).toHaveLength(DEFAULT_ATTACHMENT_LIMITS.maxCount)
        expect(result.current.atMax).toBe(true)
        expect(result.current.rejections).toHaveLength(2)
        expect(result.current.rejections[0].reason).toContain("limit")
        // At the cap, another add stages nothing more.
        act(() => {
            result.current.add([makeFile("extra.txt")])
        })
        expect(result.current.files).toHaveLength(DEFAULT_ATTACHMENT_LIMITS.maxCount)
        expect(result.current.rejections.map((r) => r.name)).toEqual(["extra.txt"])
    })

    // A paste and a drop can both fire before React re-renders. Reading the count from the
    // render closure makes both batches see zero staged files, so the cap is passed.
    it("holds the count limit across two adds in the same tick", () => {
        const {result} = setup()
        const half = Math.ceil(DEFAULT_ATTACHMENT_LIMITS.maxCount / 2) + 1
        const batch = (tag: string) =>
            Array.from({length: half}, (_, i) => makeFile(`${tag}${i}.txt`))
        act(() => {
            result.current.add(batch("a"))
            result.current.add(batch("b"))
        })
        expect(result.current.files.length).toBeLessThanOrEqual(DEFAULT_ATTACHMENT_LIMITS.maxCount)
        expect(result.current.atMax).toBe(true)
    })

    it("remove unstages one file; dismissRejections keeps files; clear drops both", () => {
        const {result} = setup()
        act(() => {
            result.current.add([
                makeFile("a.txt"),
                makeFile("b.txt"),
                makeFile("bad.mp4", "video/mp4"),
            ])
        })
        expect(result.current.files).toHaveLength(2)
        expect(result.current.rejections).toHaveLength(1)
        act(() => {
            result.current.remove(result.current.files[0].uid)
        })
        expect(result.current.files.map((f) => f.name)).toEqual(["b.txt"])
        act(() => {
            result.current.dismissRejections()
        })
        expect(result.current.rejections).toHaveLength(0)
        expect(result.current.files).toHaveLength(1)
        act(() => {
            result.current.clear()
        })
        expect(result.current.files).toHaveLength(0)
    })

    it("toParts encodes the staged files as inline data-URL file parts", async () => {
        const {result} = setup()
        act(() => {
            result.current.add([makeFile("doc.txt")])
        })
        const parts = await result.current.toParts()
        expect(parts).toHaveLength(1)
        expect(parts[0]).toMatchObject({type: "file", mediaType: "text/plain", filename: "doc.txt"})
        expect(parts[0].url.startsWith("data:text/plain;base64,")).toBe(true)
        // Empty staged set resolves to an empty list without touching FileReader.
        act(() => {
            result.current.clear()
        })
        await waitFor(async () => expect(await result.current.toParts()).toEqual([]))
    })

    it("persists staged files per session across a remount, keyed by session id", () => {
        const sessionId = `attach-restore-${Date.now()}`
        const first = setup({sessionId})
        act(() => {
            first.result.current.add([makeFile("keep.txt")])
        })
        first.unmount()
        expect(attachmentsBySession.get(sessionId)).toHaveLength(1)
        const second = setup({sessionId})
        expect(second.result.current.files.map((f) => f.name)).toEqual(["keep.txt"])
        const other = setup({sessionId: `${sessionId}-other`})
        expect(other.result.current.files).toHaveLength(0)
        // Clearing empties the per-session store too.
        act(() => {
            second.result.current.clear()
        })
        expect(attachmentsBySession.has(sessionId)).toBe(false)
    })
})
