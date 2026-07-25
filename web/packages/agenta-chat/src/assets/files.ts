// Copied verbatim from web/oss/src/components/AgentChatSlice/assets/files.ts (2026-07-25); the
// OSS original remains authoritative for the desktop chat until the re-plumb PR deletes it. Keep
// byte-parity if either side changes.
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

/** Convert picked `File`s into `file` parts for `sendMessage({text, files})`. */
export const filesToParts = (files: File[]): Promise<FileUIPart[]> =>
    Promise.all(files.map(fileToPart))

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
