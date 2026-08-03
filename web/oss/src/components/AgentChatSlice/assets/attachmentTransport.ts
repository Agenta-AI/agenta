import {safeParseWithLogging} from "@agenta/entities/shared"
import {isAxiosError, isCancel} from "axios"
import {z} from "zod"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {DEFAULT_ATTACHMENT_LIMITS, formatBytes, kindForType} from "./attachments"

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const sessionAttachmentResponseSchema = z.object({
    count: z.number().int().nonnegative(),
    attachment: z.object({
        // The server emits lowercase ids, and the adapter deliberately rejects uppercase variants.
        attachment_id: z.string().regex(CANONICAL_UUID),
        filename: z.string(),
        media_type: z.string(),
        size: z.number().int().nonnegative(),
        created_at: z.string(),
    }),
})

export type SessionAttachmentResponse = z.infer<typeof sessionAttachmentResponseSchema>

export class AttachmentUploadError extends Error {
    readonly retryable: boolean
    readonly retryAfterSeconds?: number

    constructor(
        message = "Couldn't upload the file. Try again.",
        {
            retryable = true,
            retryAfterSeconds,
        }: {retryable?: boolean; retryAfterSeconds?: number} = {},
    ) {
        super(message)
        this.name = "AttachmentUploadError"
        this.retryable = retryable
        this.retryAfterSeconds = retryAfterSeconds
    }
}

const retryAfterSeconds = (value: unknown): number | undefined => {
    const parsed = Number(Array.isArray(value) ? value[0] : value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.ceil(parsed) : undefined
}

const errorForResponse = (error: unknown, file: File): AttachmentUploadError => {
    if (!isAxiosError(error) || !error.response) return new AttachmentUploadError()

    switch (error.response.status) {
        case 413: {
            const kind = kindForType(file.type || "application/octet-stream")
            const limit = formatBytes(DEFAULT_ATTACHMENT_LIMITS.maxBytes[kind])
            const label = kind === "other" ? "file" : kind
            return new AttachmentUploadError(`This file exceeds the ${limit} ${label} limit.`, {
                retryable: false,
            })
        }
        case 422:
            return new AttachmentUploadError("This file isn't valid.", {retryable: false})
        case 429:
            return new AttachmentUploadError("This session's attachment quota is full.", {
                retryable: false,
            })
        case 409: {
            const retryIn = retryAfterSeconds(error.response.headers?.["retry-after"])
            if (retryIn !== undefined) {
                return new AttachmentUploadError(
                    `This file is already uploading. Retry in ${retryIn}s.`,
                    {retryAfterSeconds: retryIn},
                )
            }
            return new AttachmentUploadError("This upload conflicts with an earlier file.", {
                retryable: false,
            })
        }
        case 404:
            return new AttachmentUploadError("This backend does not support attachments yet.", {
                retryable: false,
            })
        default:
            return new AttachmentUploadError()
    }
}

export async function uploadAttachment({
    file,
    sessionId,
    idempotencyKey,
    onProgress,
    signal,
}: {
    file: File
    sessionId: string
    idempotencyKey: string
    onProgress?: (percent: number) => void
    signal?: AbortSignal
}): Promise<SessionAttachmentResponse> {
    const form = new FormData()
    form.append("file", file, file.name)
    form.append("idempotency_key", idempotencyKey)

    try {
        // Axios (not Fern): the Fern client uses fetch, which can't stream upload progress.
        // The explicit header matters: the shared instance defaults to application/json, and
        // axios then JSON-serializes the FormData, collapsing the File to {}.
        const response = await axios.post(`${getAgentaApiUrl()}/sessions/attachments`, form, {
            params: {session_id: sessionId},
            headers: {"Content-Type": "multipart/form-data"},
            signal,
            onUploadProgress: (event) => {
                if (onProgress && event.total) {
                    onProgress(Math.round((event.loaded / event.total) * 100))
                }
            },
        })
        const validated = safeParseWithLogging(
            sessionAttachmentResponseSchema,
            response.data,
            "[uploadAttachment]",
        )
        if (!validated) throw new AttachmentUploadError()
        return validated
    } catch (error) {
        if (signal?.aborted || isCancel(error)) throw error
        if (error instanceof AttachmentUploadError) throw error
        throw errorForResponse(error, file)
    }
}
