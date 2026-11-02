import type {EmbedUpload} from "./embedClient"

/** The attachment id in a replayed file part's URL (`/sessions/attachments/<id>/content`). */
export const attachmentIdFromUrl = (url: string | undefined): string | null =>
    /\/sessions\/attachments\/([^/?#]+)\/content/.exec(url ?? "")?.[1] ?? null

/** A picked file as the base64 upload the ingress takes. */
export const fileToUpload = (file: File): Promise<EmbedUpload> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const dataUrl = String(reader.result)
            resolve({
                filename: file.name,
                media_type: file.type || "application/octet-stream",
                data: dataUrl.slice(dataUrl.indexOf(",") + 1),
            })
        }
        reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."))
        reader.readAsDataURL(file)
    })

/** A random id for a request, from a generator that also works on plain-HTTP pages. */
export const newRequestId = (): string =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("")
