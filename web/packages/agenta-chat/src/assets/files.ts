// Copied verbatim from web/oss/src/components/AgentChatSlice/assets/files.ts (2026-07-25); the
// OSS original remains authoritative for the desktop chat until the re-plumb PR deletes it. Keep
// byte-parity if either side changes.
import type {FileUIPart, UIMessage} from "ai"

import type {AttachmentRejection} from "./attachmentRules"

/**
 * Multi-modality helpers for the agent chat slice. Attachments are kept entirely on the
 * client: there is no upload server, so a selected file is read into a `data:` URL and
 * sent inline as an AI SDK v6 `file` part (`{type, mediaType, filename, url}`). The service
 * receives the bytes in the request body — same channel as the text.
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

/**
 * A readable label for a file part: the filename, else the tail of its URL.
 *
 * The URL fallback skips `data:` URLs. `fileToPart` emits `data:<type>;base64,<...>`, whose tail
 * is the payload itself, so an unnamed inline file would be labelled with ~70 characters of
 * base64 instead of a name.
 */
export const filePartName = (part: FileUIPart): string => {
    if (part.filename) return part.filename
    if (part.url.startsWith("data:")) return "attachment"
    return part.url.split("/").pop()?.split("?")[0] || "file"
}
