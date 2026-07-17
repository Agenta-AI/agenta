/**
 * FileThumb — the grid-tile preview. Picks the cheapest faithful thumbnail per kind and stays
 * optimized: heavy strategies (PDF render, text-snippet fetch, video frame) each size-capped, and
 * the fetched bytes are CACHED briefly ({@link mountFileThumbnailBlobQueryFamily}) so scrolling a
 * tile out of the virtualized window and back doesn't refetch. Any failure falls back to the type
 * icon — a tile never blocks or errors visibly.
 *
 *   image → native <img> off the authenticated blob (browser decode)
 *   video → first frame via a metadata-only <video> seeked to 0.1s
 *   pdf   → first page rendered to a PNG data URL via lazy pdfjs (see pdfThumb)
 *   text  → first lines of the content (same shared query the preview uses)
 *   else  → the kind icon
 *
 * No IntersectionObserver gate: the grids that render tiles are virtualized, so only the visible +
 * overscan tiles are ever mounted — mounting IS the "in view" signal, and fetching on mount gives
 * the thumbnail a head start before the tile scrolls in (issue #5367). Memoized so scrolling the
 * virtualized grid never re-renders an already-resolved tile.
 */
import {memo, useEffect, useState} from "react"

import {mountFileContentQueryFamily, type Mount} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {driveFileIcon} from "./driveIcons"
import {resolveDriveFileKind, type DriveFileKind} from "./driveKinds"
import {mountFileDownloadUrl, mountFileThumbnailBlobQueryFamily} from "./driveMedia"
import {renderPdfFirstPage} from "./pdfThumb"
import {type DriveRecentFile} from "./useSessionDrive"

const IMG_CAP = 8 * 1024 * 1024
const PDF_CAP = 4 * 1024 * 1024
const TEXT_CAP = 256 * 1024
const TEXT_KINDS = new Set<DriveFileKind>(["markdown", "text", "code", "json", "csv", "html"])

/** First page of a PDF as a data URL (lazy pdfjs); only fetches when enabled and under cap. */
function usePdfThumbnail(mount: Mount | null, path: string, enabled: boolean) {
    const query = useAtomValue(
        mountFileThumbnailBlobQueryFamily({mountId: enabled ? (mount?.id ?? "") : "", path}),
    )
    const blob = enabled ? (query.data ?? null) : null
    const [url, setUrl] = useState<string | null>(null)
    useEffect(() => {
        let alive = true
        setUrl(null)
        if (!blob) return
        void renderPdfFirstPage(blob).then((u) => {
            if (alive) setUrl(u)
        })
        return () => {
            alive = false
        }
    }, [blob])
    return url
}

/** Object URL for an image file's bytes via the AUTHENTICATED blob fetch. A raw `<img src>` at the
 * download endpoint 401s on header-auth / cross-origin deployments (and it sends attachment
 * disposition), so images must go through the client like every other media body. Gated on
 * `enabled`; revokes on change/unmount. */
function useImageObjectUrl(mount: Mount | null, path: string, enabled: boolean) {
    const query = useAtomValue(
        mountFileThumbnailBlobQueryFamily({mountId: enabled ? (mount?.id ?? "") : "", path}),
    )
    const blob = enabled ? (query.data ?? null) : null
    const [url, setUrl] = useState<string | null>(null)
    useEffect(() => {
        if (!blob) {
            setUrl(null)
            return
        }
        const u = URL.createObjectURL(blob)
        setUrl(u)
        return () => URL.revokeObjectURL(u)
    }, [blob])
    return url
}

/** First lines of a text-family file (same shared content query the preview body reads). Returns
 * null while loading, "" for an empty file. */
function useTextSnippet(mount: Mount | null, path: string, enabled: boolean) {
    const query = useAtomValue(
        mountFileContentQueryFamily({mountId: enabled ? (mount?.id ?? "") : "", path}),
    )
    if (!enabled || typeof query.data !== "string") return null
    return query.data.split("\n").slice(0, 10).join("\n")
}

function FileThumbImpl({file, mount}: {file: DriveRecentFile; mount: Mount | null}) {
    const projectId = useAtomValue(projectIdAtom)
    const [failed, setFailed] = useState(false)
    const kind = resolveDriveFileKind(file.path)
    const size = file.size ?? 0

    const isImage = kind === "image" && size <= IMG_CAP
    const isVideo = kind === "video"
    const isPdf = kind === "pdf" && size > 0 && size <= PDF_CAP
    const isText = TEXT_KINDS.has(kind) && size > 0 && size <= TEXT_CAP

    const directUrl = mountFileDownloadUrl(mount, file.path, projectId)
    const imgUrl = useImageObjectUrl(mount, file.path, isImage && !failed)
    const pdfUrl = usePdfThumbnail(mount, file.path, isPdf && !failed)
    const snippet = useTextSnippet(mount, file.path, isText)

    // A consistent 4:3 preview so tiles line up and nothing letterboxes oddly; visual kinds fill
    // it (object-cover), text/icon center within it. Fixed aspect → the tile height never depends
    // on whether the thumbnail has loaded, so the grid never reflows.
    const box =
        "flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded bg-colorFillTertiary"

    // Image — decode off the authenticated blob (object URL); icon until it resolves. Covers gifs,
    // which animate straight from the object URL.
    if (isImage && imgUrl && !failed) {
        return (
            <div className={box}>
                {/* eslint-disable-next-line @next/next/no-img-element -- object URL for authed bytes; next/image can't optimize it */}
                <img
                    src={imgUrl}
                    alt=""
                    onError={() => setFailed(true)}
                    className="h-full w-full object-cover"
                />
            </div>
        )
    }

    // Video — first frame via a metadata-only element seeked just past 0.
    if (isVideo && directUrl && !failed) {
        return (
            <div className={box}>
                {/* muted + playsInline so browsers render the poster frame without autoplay policy noise */}
                <video
                    src={`${directUrl}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    onError={() => setFailed(true)}
                    className="h-full w-full object-cover"
                />
            </div>
        )
    }

    // PDF — first page rendered to a PNG (lazy pdfjs); icon until it resolves.
    if (isPdf && pdfUrl && !failed) {
        return (
            <div className={box}>
                {/* object-top so the tile shows the page's title area, not its middle. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
                <img
                    src={pdfUrl}
                    alt=""
                    className="h-full w-full bg-white object-cover object-top"
                />
            </div>
        )
    }

    // Text — a few lines, monospaced, as a document-y preview. The pre is ABSOLUTE so its content
    // can't stretch the box: a flex item's min-content height overrides `aspect-ratio`, which would
    // otherwise blow the tile up to the snippet's full height (broken grid). Absolute → out of flow.
    if (isText && snippet) {
        return (
            <div className={`${box} relative`}>
                <pre className="absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-all p-1.5 text-left font-mono text-[7px] leading-[1.35] text-colorTextTertiary">
                    {snippet}
                </pre>
            </div>
        )
    }

    // A thumbnailable file whose bytes are still loading → a soft skeleton pulse (not the type icon,
    // which would flash-swap to the thumbnail a frame later). Non-thumbnailable files show the icon
    // as their final state.
    const loadingThumb =
        !failed && ((isImage && !imgUrl) || (isPdf && !pdfUrl) || (isText && snippet === null))
    return (
        <div className={box}>
            {loadingThumb ? (
                <div className="h-full w-full animate-pulse bg-colorFillSecondary" />
            ) : (
                driveFileIcon(file.path, 22)
            )}
        </div>
    )
}

/** Memoized: identical file (path + mount + size drive the thumbnail) never re-renders when the
 * virtualized grid re-renders on scroll. */
export const FileThumb = memo(
    FileThumbImpl,
    (a, b) =>
        a.file.path === b.file.path &&
        a.mount?.id === b.mount?.id &&
        (a.file.size ?? 0) === (b.file.size ?? 0),
)
