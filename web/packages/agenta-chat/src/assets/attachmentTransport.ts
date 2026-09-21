import {safeParseWithLogging} from "@agenta/entities/shared"
import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {isAxiosError, isCancel} from "axios"
import {z} from "zod"

import {DEFAULT_ATTACHMENT_LIMITS, formatBytes, kindForType} from "./attachmentRules"

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

/**
 * The byte figure the server named in a 413, or undefined when it named none.
 *
 * The limits are per deployment (`AGENTA_ATTACHMENTS_MAX_*_BYTES`), so this client's own
 * constants are a guess about somebody else's configuration. A deployment that lowers the
 * document limit rejects a file the client happily accepted, and quoting the constant back
 * tells the person a number that is not the one they were measured against: the upload looks
 * broken rather than too big. The server says `The attachment exceeds the <n>-byte limit.`, and
 * the detail arrives either as that string or wrapped as `{message}` by the exception middleware.
 */
const serverLimitBytes = (data: unknown): number | undefined => {
    const detail = (data as {detail?: unknown} | null | undefined)?.detail
    const text =
        typeof detail === "string"
            ? detail
            : typeof (detail as {message?: unknown} | null | undefined)?.message === "string"
              ? ((detail as {message: string}).message ?? "")
              : ""
    const match = /(\d+)-byte limit/.exec(text)
    if (!match) return undefined
    const bytes = Number(match[1])
    return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined
}

const errorForResponse = (error: unknown, file: File): AttachmentUploadError => {
    if (!isAxiosError(error) || !error.response) return new AttachmentUploadError()

    switch (error.response.status) {
        case 413: {
            const kind = kindForType(file.type || "application/octet-stream")
            // Prefer the limit the server actually enforced; fall back to ours only when it
            // said nothing, so an older backend still produces a sentence rather than a blank.
            const limit = formatBytes(
                serverLimitBytes(error.response.data) ?? DEFAULT_ATTACHMENT_LIMITS.maxBytes[kind],
            )
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
