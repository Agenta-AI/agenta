// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
import type {FileUIPart, UIMessage} from "ai"

import type {AttachmentRejection} from "./attachmentRules"
import {attachmentContentUrl} from "./transcriptToMessages"

/**
 * Multi-modality helpers for the agent chat. Two send strategies share these parts:
 * - inline (`filesToParts`): the file is read into a `data:` URL and the bytes travel in the
 *   request body — no upload server involved;
 * - reference (`attachmentRefsToParts`): the file was uploaded to the sessions attachment
 *   store first and the part carries a durable content URL instead of bytes.
 */

export type FileKind = "image" | "audio" | "video" | "file"

/** Map an IANA media type to the `FileCard` `type` / a render branch. */
export const fileKind = (mediaType: string): FileKind => {
    if (mediaType.startsWith("image/")) return "image"
    if (mediaType.startsWith("audio/")) return "audio"
    if (mediaType.startsWith("video/")) return "video"
    return "file"
}

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

export interface FilesToPartsResult {
    /** The files that encoded, in the order they were given. */
    parts: FileUIPart[]
    /** The ones that did not, in the same shape the guardrails use. */
    rejections: AttachmentRejection[]
}

/**
 * Convert picked `File`s into `file` parts for `sendMessage({text, files})`.
 *
 * Settles each file on its own rather than `Promise.all`: a file that became unreadable between
 * staging and submit (moved, permission revoked, a disconnected drive) used to reject the whole
 * conversion, which lost the message text and every readable attachment with it. A read failure
 * is reported like any other rejection, so the caller can send what it has and tell the user
 * which file did not make it.
 */
export const filesToParts = async (files: File[]): Promise<FilesToPartsResult> => {
    const settled = await Promise.allSettled(files.map(fileToPart))
    const parts: FileUIPart[] = []
    const rejections: AttachmentRejection[] = []
    settled.forEach((outcome, i) => {
        if (outcome.status === "fulfilled") parts.push(outcome.value)
        else rejections.push({name: files[i]?.name ?? "attachment", reason: "could not be read"})
    })
    return {parts, rejections}
}

/** The `file` parts of a message, in order. */
export const fileParts = (message: UIMessage): FileUIPart[] =>
    message.parts.filter((p) => p.type === "file") as FileUIPart[]

/** The Agenta attachment id carried by a reference part, if present. */
export const attachmentIdForPart = (part: FileUIPart): string | null => {
    const agenta = part.providerMetadata?.agenta
    if (!agenta || typeof agenta !== "object") return null
    const attachmentId = (agenta as {attachmentId?: unknown}).attachmentId
    return typeof attachmentId === "string" && attachmentId ? attachmentId : null
}

/** A durable attachment an upload settled to — the neutral input for reference parts. */
export interface AttachmentRef {
    attachmentId: string
    filename: string
    mediaType: string
    size: number
}

/** Build reference-carrying `file` parts for uploaded attachments (no inline bytes). */
export const attachmentRefsToParts = (refs: AttachmentRef[], sessionId: string): FileUIPart[] =>
    refs.map((ref) => ({
        type: "file",
        mediaType: ref.mediaType,
        filename: ref.filename,
        url: attachmentContentUrl(sessionId, ref.attachmentId),
        providerMetadata: {
            agenta: {attachmentId: ref.attachmentId, size: ref.size},
        },
    }))

/**
 * Where to fetch a file part's bytes from RIGHT NOW.
 *
 * A reference part's `url` is baked at build time (`attachmentRefsToParts` here,
 * `transcriptToMessages` on the replay path) against whatever API host was current then — and
 * these parts are persisted with the transcript, so a host change (a different deployment, an env
 * switch, a moved domain) leaves the stored URLs pointing at the old one. The durable identity is
 * the attachment id in `providerMetadata.agenta` plus the session, so rebuild from those against
 * the CURRENT runtime host instead of trusting the stored URL.
 *
 * Inline `data:` parts and any part that predates the metadata have no id to rebuild from and keep
 * their stored URL.
 */
export const filePartContentUrl = (part: FileUIPart, sessionId: string): string => {
    const attachmentId = attachmentIdForPart(part)
    if (!attachmentId || !sessionId) return part.url
    return attachmentContentUrl(sessionId, attachmentId)
}

/**
 * A readable label for a file part: the filename, else the tail of its URL.
 *
 * The URL fallback skips `data:` URLs (`fileToPart` emits base64 payloads whose tail is the
 * payload itself) and attachment REFERENCE parts (their URLs end in the fixed `/content`
 * segment, which would label every unnamed reference "content").
 */
export const filePartName = (part: FileUIPart): string => {
    if (part.filename) return part.filename
    if (part.url.startsWith("data:") || attachmentIdForPart(part)) return "attachment"
    return part.url.split("/").pop()?.split("?")[0] || "file"
}
