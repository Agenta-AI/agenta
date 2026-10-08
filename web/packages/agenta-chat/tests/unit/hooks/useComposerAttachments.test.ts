// @vitest-environment jsdom
import {act, renderHook, waitFor} from "@testing-library/react"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

import {DEFAULT_ATTACHMENT_LIMITS} from "../../../src/assets/attachmentRules"
import {uploadAttachment, uploadFileToSessionDrive} from "../../../src/assets/attachmentTransport"
import {
    stagedFilesToParts,
    useComposerAttachments,
    withDriveFileNote,
    type ComposerAttachment,
} from "../../../src/hooks/useComposerAttachments"
import {attachmentsBySession} from "../../../src/state/sessionEphemera"

// Real module except the network call: `uploadExtraFiles` must forward the project, and the
// no-project guard must reject before the transport is ever reached.
vi.mock("../../../src/assets/attachmentTransport", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../src/assets/attachmentTransport")>()),
    uploadAttachment: vi.fn(),
    uploadFileToSessionDrive: vi.fn(),
}))

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

/** Same hook, but with the session id as a rerender prop — hosts are free to keep the composer
 * mounted across a session switch (this repo's chat workspace keeps tab panes mounted). */
const setupSwitchable = (sessionId: string) =>
    renderHook(
        ({id}: {id: string}) => useComposerAttachments({sessionId: id, uploadsEnabled: false}),
        {
            initialProps: {id: sessionId},
        },
    )

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
        // Rejections accumulate: a later add must not erase a failure the user has not read yet.
        expect(result.current.rejections.map((r) => r.name)).toEqual([
            "f100.txt",
            "f101.txt",
            "extra.txt",
        ])
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

    // The initializer only runs on mount, so a session swap under a MOUNTED hook used to write
    // session A's staged rows under session B (orphaning A's, and pointing a retry at B's upload).
    it("moves staged files back to their own session when the session changes on a mounted hook", () => {
        const a = `attach-switch-a-${Date.now()}`
        const b = `attach-switch-b-${Date.now()}`
        const {result, rerender} = setupSwitchable(a)
        act(() => {
            result.current.addFiles([makeFile("a-only.txt")])
        })
        expect(attachmentsBySession.get(a)).toHaveLength(1)

        act(() => {
            rerender({id: b})
        })
        // B starts empty, and A kept its own row.
        expect(result.current.files).toHaveLength(0)
        expect(attachmentsBySession.get(a)?.map((f) => f.name)).toEqual(["a-only.txt"])
        expect(attachmentsBySession.has(b)).toBe(false)

        act(() => {
            result.current.addFiles([makeFile("b-only.txt")])
        })
        expect(attachmentsBySession.get(b)?.map((f) => f.name)).toEqual(["b-only.txt"])
        expect(attachmentsBySession.get(a)?.map((f) => f.name)).toEqual(["a-only.txt"])

        // Switching back restores A's own tray rather than carrying B's over.
        act(() => {
            rerender({id: a})
        })
        expect(result.current.files.map((f) => f.name)).toEqual(["a-only.txt"])
        expect(attachmentsBySession.get(b)?.map((f) => f.name)).toEqual(["b-only.txt"])
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
        expect(result.current.rejections).toHaveLength(0)
    })
})

describe("uploadExtraFiles project scoping", () => {
    const store = getDefaultStore()

    afterEach(() => {
        store.set(projectIdAtom, null)
        vi.mocked(uploadAttachment).mockReset()
    })

    it("forwards the session's project to the transport", async () => {
        store.set(projectIdAtom, "project-ext")
        vi.mocked(uploadAttachment).mockResolvedValue({
            count: 1,
            attachment: {id: "att-1"},
        } as never)
        const {result} = setup()
        await act(async () => {
            await expect(
                result.current.uploadExtraFiles([makeFile("take.txt")]),
            ).resolves.toHaveLength(1)
        })
        expect(vi.mocked(uploadAttachment)).toHaveBeenCalledWith(
            expect.objectContaining({projectId: "project-ext"}),
        )
    })

    it("refuses to upload without an active project", async () => {
        store.set(projectIdAtom, null)
        const {result} = setup()
        await act(async () => {
            await expect(
                result.current.uploadExtraFiles([makeFile("take.txt")]),
            ).resolves.toBeNull()
        })
        expect(vi.mocked(uploadAttachment)).not.toHaveBeenCalled()
        // The failure is adopted into the tray as a visible, retryable error row.
        expect(result.current.files.map((f) => [f.status, f.error])).toEqual([
            ["error", "This upload needs an active project."],
        ])
    })
})

describe("files over the attachment cap", () => {
    const store = getDefaultStore()
    const overCap = DEFAULT_ATTACHMENT_LIMITS.maxBytes.document + 1

    afterEach(() => {
        store.set(projectIdAtom, null)
        vi.mocked(uploadAttachment).mockReset()
        vi.mocked(uploadFileToSessionDrive).mockReset()
    })

    const setupUploads = (largeFilesToDrive: boolean) => {
        const sessionId = `drive-${Math.random().toString(36).slice(2)}`
        return {
            sessionId,
            ...renderHook(() => useComposerAttachments({sessionId, largeFilesToDrive})),
        }
    }

    it("uploads an oversized file to the session drive and a small one as an attachment", async () => {
        store.set(projectIdAtom, "project-drive")
        vi.mocked(uploadAttachment).mockResolvedValue({
            count: 1,
            attachment: {
                attachment_id: "0190b8c0-0000-7000-8000-000000000001",
                filename: "ok.txt",
                media_type: "text/plain",
                size: 16,
                created_at: "2026-10-08T00:00:00Z",
            },
        })
        vi.mocked(uploadFileToSessionDrive).mockResolvedValue({
            drive: {path: "uploads/huge.txt", filename: "huge.txt", size: overCap},
        })
        const {result, sessionId} = setupUploads(true)

        act(() => {
            result.current.addFiles([
                makeFile("huge.txt", "text/plain", overCap),
                makeFile("ok.txt"),
            ])
        })
        expect(result.current.rejections).toHaveLength(0)
        expect(result.current.files.map((f) => f.name)).toEqual(["huge.txt", "ok.txt"])

        await waitFor(() => expect(result.current.attachmentsSettled).toBe(true))
        expect(vi.mocked(uploadFileToSessionDrive)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(uploadFileToSessionDrive)).toHaveBeenCalledWith(
            expect.objectContaining({sessionId, projectId: "project-drive"}),
        )
        expect(vi.mocked(uploadAttachment)).toHaveBeenCalledTimes(1)

        // Only the small file becomes an attachment part; the big one is named in the text.
        const parts = stagedFilesToParts(result.current.files, sessionId)
        expect(parts.map((p) => p.filename)).toEqual(["ok.txt"])
        expect(withDriveFileNote("Summarize these", result.current.files)).toBe(
            "Summarize these\n\nUploaded to the session drive (too large to attach): `uploads/huge.txt` (10.0 MB)",
        )
    })

    it("still rejects an oversized file when the host does not opt in", () => {
        store.set(projectIdAtom, "project-drive")
        const {result} = setupUploads(false)
        act(() => {
            result.current.addFiles([makeFile("huge.txt", "text/plain", overCap)])
        })
        expect(result.current.files).toHaveLength(0)
        expect(result.current.rejections.map((r) => r.name)).toEqual(["huge.txt"])
        expect(vi.mocked(uploadFileToSessionDrive)).not.toHaveBeenCalled()
    })
})

describe("withDriveFileNote", () => {
    const driveRow = (path: string, size: number): ComposerAttachment => ({
        uid: `att-${path}`,
        name: path,
        status: "done",
        response: {drive: {path, filename: path, size}},
    })

    it("returns the text unchanged when no row went to the drive", () => {
        expect(withDriveFileNote("hello", [])).toBe("hello")
    })

    it("names the drive file even when the message has no text", () => {
        expect(withDriveFileNote("", [driveRow("uploads/a.pdf", 2 * 1024 * 1024)])).toBe(
            "Uploaded to the session drive (too large to attach): `uploads/a.pdf` (2.0 MB)",
        )
    })

    it("does not repeat a note the text already carries", () => {
        const rows = [driveRow("uploads/a.pdf", 1024 * 1024)]
        const once = withDriveFileNote("hi", rows)
        expect(withDriveFileNote(once, rows)).toBe(once)
    })
})
