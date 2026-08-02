import type {FileUIPart, UIMessage} from "ai"
import type {UploadFile} from "antd"

import {attachmentContentUrl} from "./attachmentMedia"
import type {SessionAttachmentResponse} from "./attachmentTransport"

/** Helpers for sending and rendering attachment references without embedding file bytes. */

export type FileKind = "image" | "audio" | "video" | "file"

/** Map an IANA media type to the `FileCard` `type` or a render branch. */
export const fileKind = (mediaType: string): FileKind => {
    if (mediaType.startsWith("image/")) return "image"
    if (mediaType.startsWith("audio/")) return "audio"
    if (mediaType.startsWith("video/")) return "video"
    return "file"
}

/** Convert uploaded tray entries into reference-carrying AI SDK file parts. */
export const filesToParts = (
    files: UploadFile<SessionAttachmentResponse>[],
    sessionId: string,
): FileUIPart[] =>
    files.map((file) => {
        const attachment = file.response?.attachment
        if (!attachment) throw new Error(`Attachment upload is incomplete: ${file.name}`)
        return {
            type: "file",
            mediaType: attachment.media_type,
            filename: attachment.filename,
            url: attachmentContentUrl(sessionId, attachment.attachment_id),
            providerMetadata: {
                agenta: {attachmentId: attachment.attachment_id, size: attachment.size},
            },
        }
    })

/** Read one `File` into a `data:` URL `file` part. */
const fileToPart = (file: File): Promise<FileUIPart> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error)
        reader.onload = () =>
            resolve({
                type: "file",
                mediaType: file.type || "application/octet-stream",
                filename: file.name,
                url: reader.result as string, // data:<mediaType>;base64,<...>
            })
        reader.readAsDataURL(file)
    })

export interface FileReadResult {
    parts: FileUIPart[]
    /** Files the browser refused to read (revoked blob, moved/locked on disk), in input order. */
    unreadable: File[]
}

/**
 * Preserve the pre-upload voice path by reading recorder files into inline data URLs.
 *
 * Never rejects. Every send path drops this promise (composer submit, voice take, empty-state
 * Start, the first-run seed), so a `Promise.all` that threw on one unreadable file surfaced as an
 * unhandled rejection and a send that silently did nothing. Failures come back as data instead.
 */
export const filesToInlineParts = async (files: File[]): Promise<FileReadResult> => {
    const settled = await Promise.allSettled(files.map(fileToPart))
    const parts: FileUIPart[] = []
    const unreadable: File[] = []
    settled.forEach((result, i) => {
        if (result.status === "fulfilled") parts.push(result.value)
        else unreadable.push(files[i])
    })
    return {parts, unreadable}
}

/** The `file` parts of a message, in order. */
export const fileParts = (message: UIMessage): FileUIPart[] =>
    message.parts.filter((part) => part.type === "file") as FileUIPart[]

/** The Agenta attachment id carried by a reference part, if present. */
export const attachmentIdForPart = (part: FileUIPart): string | null => {
    const agenta = part.providerMetadata?.agenta
    if (!agenta || typeof agenta !== "object") return null
    const attachmentId = (agenta as {attachmentId?: unknown}).attachmentId
    return typeof attachmentId === "string" && attachmentId ? attachmentId : null
}

/** A readable label for a file part. */
export const filePartName = (part: FileUIPart): string => part.filename || "attachment"
