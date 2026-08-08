import type {StagedUpload as UploadFile} from "@agenta/chat/model"
import {describe, expect, it, vi} from "vitest"

import {isUploadRetryReady, removeUploadFile} from "../../../src/hooks/useAttachmentUploads"

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
