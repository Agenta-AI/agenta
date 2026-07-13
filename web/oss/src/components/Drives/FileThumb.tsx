/**
 * FileThumb — the grid-tile preview. Picks the cheapest faithful thumbnail per kind and stays
 * optimized: heavy strategies (PDF render, text-snippet fetch, video frame) are gated behind an
 * IntersectionObserver so an off-screen tile costs nothing, and each is size-capped. Any failure
 * falls back to the type icon — a tile never blocks or errors visibly.
 *
 *   image → native lazy <img> at the bytes URL (browser decode, no JS heap)
 *   video → first frame via a metadata-only <video> seeked to 0.1s
 *   pdf   → first page rendered to a PNG data URL via lazy pdfjs (see pdfThumb)
 *   text  → first lines of the content (same shared query the preview uses)
 *   else  → the kind icon
 */
import {useEffect, useRef, useState} from "react"

import {mountFileContentQueryFamily, type Mount} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {driveFileIcon} from "./DriveDrawer"
import {mountFileBlobQueryFamily, mountFileDownloadUrl} from "./driveMedia"
import {renderPdfFirstPage} from "./pdfThumb"
import {resolveDriveFileKind, type DriveFileKind} from "./renderers"
import {type DriveRecentFile} from "./useSessionDrive"

const IMG_CAP = 2 * 1024 * 1024
const PDF_CAP = 4 * 1024 * 1024
const TEXT_CAP = 256 * 1024
const TEXT_KINDS = new Set<DriveFileKind>(["markdown", "text", "code", "json", "csv"])

/** Becomes true once the element scrolls within 200px of the viewport; latches so a tile loads
 * its thumbnail once and never re-tears it down on scroll-out. */
function useInView<T extends Element>() {
    const ref = useRef<T>(null)
    const [inView, setInView] = useState(false)
    useEffect(() => {
        const el = ref.current
        if (!el || inView) return
        const obs = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setInView(true)
                    obs.disconnect()
                }
            },
            {rootMargin: "200px"},
        )
        obs.observe(el)
        return () => obs.disconnect()
    }, [inView])
    return {ref, inView}
}

/** First page of a PDF as a data URL (lazy pdfjs); only fetches when in view and under cap. */
function usePdfThumbnail(mount: Mount | null, path: string, enabled: boolean) {
    const query = useAtomValue(
        mountFileBlobQueryFamily({mountId: enabled ? (mount?.id ?? "") : "", path}),
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

/** First lines of a text-family file (same shared content query the preview body reads). */
function useTextSnippet(mount: Mount | null, path: string, enabled: boolean) {
    const query = useAtomValue(
        mountFileContentQueryFamily({mountId: enabled ? (mount?.id ?? "") : "", path}),
    )
    if (!enabled || typeof query.data !== "string") return null
    return query.data.split("\n").slice(0, 10).join("\n")
}

export function FileThumb({file, mount}: {file: DriveRecentFile; mount: Mount | null}) {
    const projectId = useAtomValue(projectIdAtom)
    const {ref, inView} = useInView<HTMLDivElement>()
    const [failed, setFailed] = useState(false)
    const kind = resolveDriveFileKind(file.path)
    const size = file.size ?? 0

    const isImage = kind === "image" && size <= IMG_CAP
    const isVideo = kind === "video"
    const isPdf = kind === "pdf" && size > 0 && size <= PDF_CAP
    const isText = TEXT_KINDS.has(kind) && size > 0 && size <= TEXT_CAP

    const directUrl = mountFileDownloadUrl(mount, file.path, projectId)
    const pdfUrl = usePdfThumbnail(mount, file.path, isPdf && inView && !failed)
    const snippet = useTextSnippet(mount, file.path, isText && inView)

    // A consistent 4:3 preview so tiles line up and nothing letterboxes oddly; visual kinds fill
    // it (object-cover), text/icon center within it.
    const box =
        "flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded bg-colorFillTertiary"

    // Image — native lazy decode straight off the bytes URL.
    if (isImage && directUrl && !failed) {
        return (
            <div ref={ref} className={box}>
                {/* eslint-disable-next-line @next/next/no-img-element -- authed dynamic bytes URL; next/image can't optimize it */}
                <img
                    src={directUrl}
                    alt=""
                    loading="lazy"
                    onError={() => setFailed(true)}
                    className="h-full w-full object-cover"
                />
            </div>
        )
    }

    // Video — first frame via a metadata-only element seeked just past 0.
    if (isVideo && directUrl && !failed) {
        return (
            <div ref={ref} className={box}>
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
            <div ref={ref} className={box}>
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

    // Text — a few lines, monospaced, as a document-y preview.
    if (isText && snippet) {
        return (
            <div ref={ref} className={`${box} !items-start !justify-start`}>
                <pre className="m-0 max-h-full w-full overflow-hidden whitespace-pre-wrap break-all p-1.5 text-left font-mono text-[7px] leading-[1.35] text-colorTextTertiary">
                    {snippet}
                </pre>
            </div>
        )
    }

    // Fallback — the kind icon (also the not-yet-loaded state for lazy thumbnails).
    return (
        <div ref={ref} className={box}>
            {driveFileIcon(file.path, 22)}
        </div>
    )
}
