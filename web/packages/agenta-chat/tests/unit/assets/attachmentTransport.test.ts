// @vitest-environment node
// jsdom's File has no `text()`, and this suite asserts on the multipart body it builds.
import type {AxiosProgressEvent} from "axios"
import {CanceledError} from "axios"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {axios} from "@agenta/shared/api"

import {AttachmentUploadError, uploadAttachment} from "../../../src/assets/attachmentTransport"

vi.mock("@agenta/shared/api", () => ({
    axios: {post: vi.fn()},
    getAgentaApiUrl: vi.fn(() => "https://api.example.test"),
}))

const attachmentId = "0198f489-8c20-7000-8000-000000000001"
const idempotencyKey = "0198f489-8c20-7000-8000-000000000002"
const response = {
    count: 1,
    attachment: {
        attachment_id: attachmentId,
        filename: "notes.txt",
        media_type: "text/plain",
        size: 5,
        created_at: "2026-07-31T12:00:00Z",
    },
}

describe("uploadAttachment", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("posts the multipart fields and returns a validated response", async () => {
        vi.mocked(axios.post).mockResolvedValue({data: response})
        const file = new File(["hello"], "notes.txt", {type: "text/plain"})

        await expect(
            uploadAttachment({file, sessionId: "session-1", idempotencyKey}),
        ).resolves.toEqual(response)

        const [url, body, config] = vi.mocked(axios.post).mock.calls[0]
        expect(url).toBe("https://api.example.test/sessions/attachments")
        expect(config?.params).toEqual({session_id: "session-1"})
        expect(body).toBeInstanceOf(FormData)
        const form = body as FormData
        expect(form.get("idempotency_key")).toBe(idempotencyKey)
        const uploaded = form.get("file") as File
        expect(uploaded.name).toBe("notes.txt")
        await expect(uploaded.text()).resolves.toBe("hello")
    })

    it("reports upload progress", async () => {
        vi.mocked(axios.post).mockResolvedValue({data: response})
        const onProgress = vi.fn()

        await uploadAttachment({
            file: new File(["hello"], "notes.txt"),
            sessionId: "session-1",
            idempotencyKey,
            onProgress,
        })

        const config = vi.mocked(axios.post).mock.calls[0][2]
        config?.onUploadProgress?.({loaded: 1, total: 4} as AxiosProgressEvent)
        expect(onProgress).toHaveBeenCalledWith(25)
    })

    it("forwards the abort signal and preserves cancellation", async () => {
        const controller = new AbortController()
        vi.mocked(axios.post).mockImplementation(
            (_url, _body, config) =>
                new Promise((_resolve, reject) => {
                    config?.signal?.addEventListener("abort", () => {
                        reject(new CanceledError("canceled"))
                    })
                }),
        )

        const upload = uploadAttachment({
            file: new File(["hello"], "notes.txt"),
            sessionId: "session-1",
            idempotencyKey,
            signal: controller.signal,
        })
        controller.abort()

        await expect(upload).rejects.toBeInstanceOf(CanceledError)
        expect(vi.mocked(axios.post).mock.calls[0][2]?.signal).toBe(controller.signal)
    })

    it("turns a network failure into a retryable user-safe error", async () => {
        vi.mocked(axios.post).mockRejectedValue(new Error("socket path and token details"))

        const upload = uploadAttachment({
            file: new File(["hello"], "notes.txt"),
            sessionId: "session-1",
            idempotencyKey,
        })

        await expect(upload).rejects.toMatchObject({
            name: "AttachmentUploadError",
            message: "Couldn't upload the file. Try again.",
            retryable: true,
        })
    })

    it.each([
        [413, "text/plain", "This file exceeds the 10.0 MB document limit."],
        [422, "text/plain", "This file isn't valid."],
        [429, "text/plain", "This session's attachment quota is full."],
        [404, "text/plain", "This backend does not support attachments yet."],
    ])("maps HTTP %s to a short non-retryable error", async (status, mediaType, message) => {
        vi.mocked(axios.post).mockRejectedValue({
            isAxiosError: true,
            response: {status, headers: {}},
        })

        const upload = uploadAttachment({
            file: new File(["hello"], "notes.txt", {type: mediaType}),
            sessionId: "session-1",
            idempotencyKey,
        })

        await expect(upload).rejects.toMatchObject({message, retryable: false})
    })

    it("honours Retry-After for an upload already in flight", async () => {
        vi.mocked(axios.post).mockRejectedValue({
            isAxiosError: true,
            response: {status: 409, headers: {"retry-after": "7"}},
        })

        const upload = uploadAttachment({
            file: new File(["hello"], "notes.txt"),
            sessionId: "session-1",
            idempotencyKey,
        })

        await expect(upload).rejects.toMatchObject({
            message: "This file is already uploading. Retry in 7s.",
            retryable: true,
            retryAfterSeconds: 7,
        })
    })

    it("logs schema drift and throws a controlled retryable error", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        vi.mocked(axios.post).mockResolvedValue({
            data: {...response, attachment: {...response.attachment, attachment_id: "not-a-uuid"}},
        })

        const upload = uploadAttachment({
            file: new File(["hello"], "notes.txt"),
            sessionId: "session-1",
            idempotencyKey,
        })

        await expect(upload).rejects.toBeInstanceOf(AttachmentUploadError)
        expect(consoleError).toHaveBeenCalledWith(
            "[uploadAttachment] Validation failed:",
            expect.any(Object),
        )
        consoleError.mockRestore()
    })

    it("rejects uppercase attachment ids emitted outside the canonical server contract", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        vi.mocked(axios.post).mockResolvedValue({
            data: {
                ...response,
                attachment: {...response.attachment, attachment_id: attachmentId.toUpperCase()},
            },
        })

        const upload = uploadAttachment({
            file: new File(["hello"], "notes.txt"),
            sessionId: "session-1",
            idempotencyKey,
        })

        await expect(upload).rejects.toBeInstanceOf(AttachmentUploadError)
        consoleError.mockRestore()
    })
})
