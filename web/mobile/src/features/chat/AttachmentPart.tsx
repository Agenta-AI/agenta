import {Paperclip} from "lucide-react"

interface FilePart {
    url?: string
    mediaType?: string
    filename?: string
}

const isImage = (mediaType?: string) => Boolean(mediaType?.startsWith("image/"))

/**
 * One attachment on a replayed message. The URL is the durable content endpoint, so it carries
 * the session cookie — an <img> loads it directly, anything else stays a labelled link rather
 * than a download this screen cannot preview.
 */
export const AttachmentPart = ({part}: {part: FilePart}) => {
    const {url, mediaType, filename} = part
    if (!url) return null

    if (isImage(mediaType)) {
        return (
            <a href={url} target="_blank" rel="noreferrer" className="block max-w-full">
                {/* Plain <img>: next/image would need the API host allow-listed and cannot
                    optimize a cookie-authenticated content endpoint. */}
                <img
                    src={url}
                    alt={filename || "attachment"}
                    className="border-border max-h-60 w-auto max-w-full rounded-lg border object-contain"
                />
            </a>
        )
    }

    return (
        <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="border-border text-muted-foreground flex min-h-11 max-w-full items-center gap-2 rounded-lg border px-3 text-xs"
        >
            <Paperclip aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{filename || mediaType || "attachment"}</span>
        </a>
    )
}
