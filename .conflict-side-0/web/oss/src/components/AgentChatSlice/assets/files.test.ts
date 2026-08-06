import type {UploadFile} from "antd"
import {describe, expect, it} from "vitest"

import type {SessionAttachmentResponse} from "./attachmentTransport"
import {filePartName, filesToParts} from "./files"

const firstAttachmentId = "019c1e0a-f911-7000-8000-000000000001"

const upload = (attachmentId: string): UploadFile<SessionAttachmentResponse> => ({
    uid: attachmentId,
    name: "notes.txt",
    status: "done",
    response: {
        count: 1,
        attachment: {
            attachment_id: attachmentId,
            filename: "notes.txt",
            media_type: "text/plain",
            size: 42,
            created_at: "2026-07-31T12:00:00Z",
        },
    },
})

describe("attachment file parts", () => {
    it("stores size under providerMetadata.agenta", () => {
        const part = filesToParts([upload(firstAttachmentId)], "session-1")[0]

        expect(part).toMatchObject({
            type: "file",
            filename: "notes.txt",
            providerMetadata: {
                agenta: {attachmentId: firstAttachmentId, size: 42},
            },
        })
        expect(part).not.toHaveProperty("size")
    })

    it("uses attachment when a replayed part has no filename", () => {
        expect(
            filePartName({
                type: "file",
                mediaType: "text/plain",
                url: "https://api.example.test/attachments/id/content",
            }),
        ).toBe("attachment")
    })
})
