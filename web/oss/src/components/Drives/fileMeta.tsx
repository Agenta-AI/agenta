/**
 * DriveFileMetaList — the "everything we can know about this file" block, shown above the preview
 * in the Build drawer and the chat Quick Look. Split into two tiers:
 *  - Free facts (no bytes): type label, guessed MIME, exact byte count, location, modified time.
 *  - Derived facts (piggy-back on bytes the preview already loads — same shared queries, no extra
 *    fetch): image/video pixel dimensions, audio/video duration, text/code line + char counts.
 * The listing still carries no content-type or mtime (backend gap), so MIME is extension-guessed
 * and "modified" only shows when a durable/live activity signal stamped the file.
 */
import {useEffect, useState} from "react"

import {mountFileContentQueryFamily, type Mount} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import {fileTypeLabel, resolveDriveFileKind, type DriveFileKind} from "./driveKinds"
import {useMountFileMediaSrc} from "./driveMedia"
import {humanSize, relativeTime} from "./driveTree"

// Extension → MIME (best-effort; the listing carries no content-type). Mirrors the renderer's
// kind table so previews and this block never disagree about what a file is.
const MIME: Record<string, string> = {
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    log: "text/plain",
    env: "text/plain",
    json: "application/json",
    yaml: "application/yaml",
    yml: "application/yaml",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    flac: "audio/flac",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    py: "text/x-python",
    ts: "text/typescript",
    tsx: "text/tsx",
    js: "text/javascript",
    jsx: "text/jsx",
    html: "text/html",
    css: "text/css",
    sql: "application/sql",
}

const mimeFor = (path: string): string => {
    const ext = path.split(".").pop()?.toLowerCase() ?? ""
    return ext && ext !== path ? (MIME[ext] ?? `application/${ext}`) : "application/octet-stream"
}

const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return ""
    const s = Math.round(seconds)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    const two = (n: number) => String(n).padStart(2, "0")
    return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

const TEXT_KINDS = new Set<DriveFileKind>(["markdown", "text", "code", "json", "csv"])

/** Pixel dimensions for an image, decoded off a shared (browser-cached) src — no extra download
 * beyond the one the preview makes. */
function useImageDimensions(mount: Mount | null, path: string, enabled: boolean) {
    const {src} = useMountFileMediaSrc(mount, enabled ? path : "")
    const [dim, setDim] = useState<{w: number; h: number} | null>(null)
    useEffect(() => {
        setDim(null)
        if (!enabled || !src) return
        const img = new Image()
        img.onload = () => setDim({w: img.naturalWidth, h: img.naturalHeight})
        img.src = src
        return () => {
            img.onload = null
        }
    }, [src, enabled])
    return dim
}

/** Duration (and, for video, pixel dimensions) via a metadata-only media probe — `preload
 * "metadata"` fetches just the moov/header, not the whole file. */
function useMediaMetadata(
    mount: Mount | null,
    path: string,
    kind: DriveFileKind,
    enabled: boolean,
) {
    const {src} = useMountFileMediaSrc(mount, enabled ? path : "")
    const [info, setInfo] = useState<{duration?: number; w?: number; h?: number} | null>(null)
    useEffect(() => {
        setInfo(null)
        if (!enabled || !src) return
        const el = document.createElement(kind === "video" ? "video" : "audio")
        el.preload = "metadata"
        const onMeta = () => {
            const video = el as HTMLVideoElement
            setInfo({
                duration: Number.isFinite(el.duration) ? el.duration : undefined,
                w: video.videoWidth || undefined,
                h: video.videoHeight || undefined,
            })
        }
        el.addEventListener("loadedmetadata", onMeta)
        el.src = src
        return () => {
            el.removeEventListener("loadedmetadata", onMeta)
            el.removeAttribute("src")
            el.load()
        }
    }, [src, kind, enabled])
    return info
}

const MetaRow = ({label, value}: {label: string; value: React.ReactNode}) =>
    value ? (
        <>
            <dt className="text-colorTextTertiary">{label}</dt>
            <dd className="m-0 min-w-0 truncate font-mono text-colorTextSecondary">{value}</dd>
        </>
    ) : null

export function DriveFileMetaList({
    mount,
    path,
    size,
    touchedAt,
}: {
    mount: Mount | null
    path: string
    size?: number | null
    touchedAt?: number
}) {
    const kind = resolveDriveFileKind(path)
    const folder = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "root"

    const isImage = kind === "image"
    const isMedia = kind === "audio" || kind === "video"
    const isText = TEXT_KINDS.has(kind)

    const dimensions = useImageDimensions(mount, path, isImage)
    const media = useMediaMetadata(mount, path, kind, isMedia)
    // Reuses the exact query the preview body reads (same key) — deduped, no extra fetch.
    const contentQuery = useAtomValue(
        mountFileContentQueryFamily({mountId: isText ? (mount?.id ?? "") : "", path}),
    )
    const content = isText && typeof contentQuery.data === "string" ? contentQuery.data : null

    const dims = dimensions
        ? `${dimensions.w} × ${dimensions.h} px`
        : media?.w && media?.h
          ? `${media.w} × ${media.h} px`
          : null
    const duration = media?.duration ? formatDuration(media.duration) : null
    const textStats = content
        ? `${content.split("\n").length.toLocaleString()} lines · ${content.length.toLocaleString()} chars`
        : null

    return (
        // Two label/value pairs per row (4-col grid; empty MetaRows return null so present pairs
        // auto-flow) — keeps the metadata block compact so the file content sits higher. Label
        // tracks are a FIXED width (not `auto`): which labels flow into a track changes per file
        // (Content vs Dimensions vs Duration), so `auto` resized the columns and slid the right
        // half sideways as you paged. 4.5rem fits the longest label ("Dimensions").
        <dl className="grid grid-cols-[4.5rem_1fr_4.5rem_1fr] gap-x-4 gap-y-1.5 text-[11px]">
            <MetaRow label="Type" value={fileTypeLabel(path)} />
            <MetaRow label="MIME" value={mimeFor(path)} />
            <MetaRow
                label="Size"
                value={
                    size != null ? `${humanSize(size)} · ${size.toLocaleString()} bytes` : undefined
                }
            />
            <MetaRow label="Location" value={folder} />
            <MetaRow label="Dimensions" value={dims} />
            <MetaRow label="Duration" value={duration} />
            <MetaRow label="Content" value={textStats} />
            <MetaRow label="Modified" value={touchedAt ? relativeTime(touchedAt) : undefined} />
        </dl>
    )
}
