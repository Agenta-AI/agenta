import {useEffect, useState} from "react"

import {DownloadSimple, File} from "@phosphor-icons/react"

import {attachmentIdFromUrl} from "./embedFiles"

/** One conversation file, fetched as a blob: `<img>` and `<a>` cannot send the visitor key. */
export const EmbedFile = ({
    url,
    name,
    mediaType,
    fileBlob,
}: {
    url: string | undefined
    name: string
    mediaType: string
    fileBlob: (fileId: string) => Promise<Blob>
}) => {
    const fileId = attachmentIdFromUrl(url)
    const image = mediaType.startsWith("image/")
    const [preview, setPreview] = useState<string | null>(null)

    useEffect(() => {
        if (!fileId || !image) return
        let objectUrl: string | null = null
        let cancelled = false
        fileBlob(fileId)
            .then((blob) => {
                if (cancelled) return
                objectUrl = URL.createObjectURL(blob)
                setPreview(objectUrl)
            })
            .catch(() => undefined)
        return () => {
            cancelled = true
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [fileBlob, fileId, image])

    const download = async () => {
        if (!fileId) return
        const objectUrl = URL.createObjectURL(await fileBlob(fileId))
        const link = document.createElement("a")
        link.href = objectUrl
        link.download = name
        link.click()
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
    }

    if (preview)
        return (
            <button type="button" onClick={() => void download()} aria-label={`Download ${name}`}>
                <img src={preview} alt={name} className="max-h-48 max-w-full rounded-md" />
            </button>
        )
    return (
        <button
            type="button"
            disabled={!fileId}
            onClick={() => void download()}
            className="flex max-w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-70"
        >
            <File size={14} className="shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
            {fileId ? (
                <DownloadSimple size={14} className="shrink-0 text-muted-foreground" />
            ) : null}
        </button>
    )
}
