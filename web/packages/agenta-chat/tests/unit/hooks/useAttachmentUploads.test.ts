// @vitest-environment jsdom
import {useState} from "react"

import {act, renderHook} from "@testing-library/react"
import {describe, expect, it, vi} from "vitest"

import type {StagedUpload as UploadFile} from "@agenta/chat/model"

import {
    isUploadRetryReady,
    removeUploadFile,
    UPLOAD_CANCELLED_MESSAGE,
    useAttachmentUploads,
} from "../../../src/hooks/useAttachmentUploads"

describe("attachment upload controls", () => {
    it("aborts an in-flight upload before removing its chip", () => {
        const abort = vi.fn()
        const files: UploadFile[] = [
            {uid: "remove-me", name: "first.txt", status: "uploading"},
            {uid: "keep-me", name: "second.txt", status: "done"},
        ]
        let nextFiles: UploadFile[] = []

        removeUploadFile("remove-me", abort, (updater) => {
            expect(abort).toHaveBeenCalledWith("remove-me")
            nextFiles = updater(files)
        })

        expect(nextFiles).toEqual([files[1]])
    })

    it("holds retry until the Retry-After deadline", () => {
        expect(isUploadRetryReady(7_000, 6_999)).toBe(false)
        expect(isUploadRetryReady(7_000, 7_000)).toBe(true)
    })
})

/** Drives the hook the way the tray does: `files` is real state, so every `patch` hands the effect
 * a NEW array identity — which is exactly what used to restart an aborted upload. */
const useTray = (upload: Parameters<typeof useAttachmentUploads<string>>[2]) => {
    const [files, setFiles] = useState<UploadFile<string>[]>([])
    const uploads = useAttachmentUploads<string>(files, setFiles, upload)
    return {files, setFiles, uploads}
}

describe("useAttachmentUploads lifecycle", () => {
    const stage = (uid: string): UploadFile<string> => ({
        uid,
        name: `${uid}.txt`,
        status: "uploading",
        percent: 0,
        originFileObj: new File([new Uint8Array(4)], `${uid}.txt`, {type: "text/plain"}),
    })

    it("starts an enqueued upload and settles it", async () => {
        const upload = vi.fn(async () => "ok")
        const {result} = renderHook(() => useTray(upload))
        await act(async () => {
            result.current.setFiles([stage("one")])
            result.current.uploads.enqueue(["one"])
        })
        expect(upload).toHaveBeenCalledTimes(1)
        expect(result.current.files[0].status).toBe("done")
        expect(result.current.files[0].response).toBe("ok")
    })

    // `abort` used only to pause: it dropped the controller but left the row reading "uploading",
    // which is precisely what the remount-resume rule restarts — and mid-upload the list identity
    // changes many times a second, so the next progress tick relaunched the request.
    it("abort cancels for good — the row settles and the resume rule leaves it alone", async () => {
        // Never resolves on its own, so only the abort can end it.
        const upload = vi.fn(
            (_file: File, ctx: {signal: AbortSignal}) =>
                new Promise<string>((_resolve, reject) => {
                    ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))
                }),
        )
        const {result} = renderHook(() => useTray(upload))
        await act(async () => {
            result.current.setFiles([stage("one")])
            result.current.uploads.enqueue(["one"])
        })
        expect(upload).toHaveBeenCalledTimes(1)

        await act(async () => {
            result.current.uploads.abort("one")
        })
        expect(result.current.files[0].status).toBe("error")
        expect(result.current.files[0].error).toBe(UPLOAD_CANCELLED_MESSAGE)

        // A fresh `files` identity (what a progress tick or any other tray edit produces) must not
        // resurrect it.
        await act(async () => {
            result.current.setFiles((prev) => prev.map((f) => ({...f})))
        })
        expect(upload).toHaveBeenCalledTimes(1)
        expect(result.current.files[0].status).toBe("error")

        // An explicit retry is still an un-cancel.
        await act(async () => {
            result.current.uploads.retry("one")
        })
        expect(upload).toHaveBeenCalledTimes(2)
    })

    // The unmount teardown aborts controllers directly (not through `abort`), so a tray that comes
    // back with the same uid still picks its in-flight entry up.
    it("resumes an in-flight row that was never cancelled by the user", async () => {
        const upload = vi.fn(
            (_file: File, ctx: {signal: AbortSignal}) =>
                new Promise<string>((_resolve, reject) => {
                    ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))
                }),
        )
        const {result} = renderHook(() => useTray(upload))
        // A row restored from the per-session store: still "uploading", no controller here.
        await act(async () => {
            result.current.setFiles([stage("restored")])
        })
        expect(upload).toHaveBeenCalledTimes(1)
    })
})
