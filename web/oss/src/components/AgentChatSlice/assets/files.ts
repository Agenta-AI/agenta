import type {FileUIPart, UIMessage} from "ai"

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

export interface FileReadResult {
    parts: FileUIPart[]
    /** Files the browser refused to read (revoked blob, moved/locked on disk), in input order. */
    unreadable: File[]
}

/**
 * Convert picked `File`s into `file` parts for `sendMessage({text, files})`.
 *
 * Never rejects. Every send path drops this promise (composer submit, voice take, empty-state
 * Start, the first-run seed), so a `Promise.all` that threw on one unreadable file surfaced as an
 * unhandled rejection and a send that silently did nothing. Failures come back as data instead.
 */
export const filesToParts = async (files: File[]): Promise<FileReadResult> => {
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
    message.parts.filter((p) => p.type === "file") as FileUIPart[]

/** A readable label for a file part (filename, else the tail of its URL). */
export const filePartName = (part: FileUIPart): string =>
    part.filename || part.url.split("/").pop()?.split("?")[0] || "file"
