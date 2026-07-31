import type {FileUIPart, UIMessage} from "ai"
import type {UploadFile} from "antd"
import {describe, expect, it} from "vitest"

import type {SessionAttachmentResponse} from "./attachmentTransport"
import {attachmentNamesByMessage, filePartName, filesToParts} from "./files"

const firstAttachmentId = "019c1e0a-f911-7000-8000-000000000001"
const secondAttachmentId = "019c1e0a-f911-7000-8000-000000000002"

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

    it("joins each delivery id to the preceding user message filename", () => {
        const file = (attachmentId: string, filename: string): FileUIPart => ({
            type: "file",
            mediaType: "text/plain",
            filename,
            url: `https://api.example.test/${attachmentId}/content`,
            providerMetadata: {agenta: {attachmentId}},
        })
        const messages = [
            {
                id: "user-1",
                role: "user",
                parts: [
                    file(firstAttachmentId, "first.txt"),
                    file(secondAttachmentId, "second.txt"),
                ],
            },
            {id: "assistant-1", role: "assistant", parts: []},
        ] as UIMessage[]

        expect(attachmentNamesByMessage(messages).get("assistant-1")).toEqual(
            new Map([
                [firstAttachmentId, "first.txt"],
                [secondAttachmentId, "second.txt"],
            ]),
        )
    })
})
