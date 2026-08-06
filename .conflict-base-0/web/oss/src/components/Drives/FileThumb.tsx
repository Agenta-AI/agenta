/**
 * FileThumb — the grid-tile preview. Picks the cheapest faithful thumbnail per kind and stays
 * optimized: image/pdf tiles are downscaled/rendered to a SMALL data-URL on the client
 * ({@link mountFileThumbnailQueryFamily}) and only that tiny string is cached — never the full-size
 * original — so browsing thousands of media files keeps memory bounded and scroll-back is instant.
 * Each strategy is size-capped; any failure falls back to the type icon — a tile never blocks.
 *
 *   image → downscaled to a ~256px webp data URL (full bytes fetched, converted, dropped)
 *   video → first frame via a metadata-only <video> seeked to 0.1s (browser partial-fetches)
 *   pdf   → first page rendered to a small PNG data URL via lazy pdfjs (see pdfThumb)
 *   text  → first lines of the content (same shared query the preview uses)
 *   else  → the kind icon
 *
 * No IntersectionObserver gate: the grids that render tiles are virtualized, so only the visible +
 * overscan tiles are ever mounted — mounting IS the "in view" signal, and fetching on mount gives
 * the thumbnail a head start before the tile scrolls in (issue #5367). Memoized so scrolling the
 * virtualized grid never re-renders an already-resolved tile.
 */
import {memo, useState} from "react"

import {mountFileContentQueryFamily, type Mount} from "@agenta/entities/session"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {driveFileIcon} from "./driveIcons"
import {resolveDriveFileKind, type DriveFileKind} from "./driveKinds"
import {mountFileDownloadUrl, mountFileThumbnailQueryFamily} from "./driveMedia"
import {type DriveRecentFile} from "./useSessionDrive"

const IMG_CAP = 8 * 1024 * 1024
const PDF_CAP = 4 * 1024 * 1024
const TEXT_CAP = 256 * 1024
const TEXT_KINDS = new Set<DriveFileKind>(["markdown", "text", "code", "json", "csv", "html"])

/** Small thumbnail data-URL (downscaled image or rendered PDF page), cached as a lightweight string
 * so the grid never pins full-size originals in memory. Disabled (no fetch) unless `enabled`. */
function useThumbnail(mount: Mount | null, path: string, mode: "image" | "pdf", enabled: boolean) {
    const query = useAtomValue(
        mountFileThumbnailQueryFamily({mountId: enabled ? (mount?.id ?? "") : "", path, mode}),
    )
    return enabled ? (query.data ?? null) : null
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

function FileThumbImpl({
    file,
    mount,
    staticThumb,
}: {
    file: DriveRecentFile
    mount: Mount | null
    /** Kind icon only — never fetch a content thumbnail. For the always-mounted summary surfaces
     * (chat rail) so opening a conversation doesn't read every recent file just to draw a preview;
     * the on-demand browser (grid/tiles) still renders real thumbnails. */
    staticThumb?: boolean
}) {
    const projectId = useAtomValue(projectIdAtom)
    const [failed, setFailed] = useState(false)
    const kind = resolveDriveFileKind(file.path)
    const size = file.size ?? 0
    const wantThumb = !staticThumb

    const isImage = kind === "image" && size <= IMG_CAP
    const isVideo = kind === "video"
    const isPdf = kind === "pdf" && size > 0 && size <= PDF_CAP
    const isText = TEXT_KINDS.has(kind) && size > 0 && size <= TEXT_CAP

    const directUrl = mountFileDownloadUrl(mount, file.path, projectId)
    const imgUrl = useThumbnail(mount, file.path, "image", isImage && !failed && wantThumb)
    const pdfUrl = useThumbnail(mount, file.path, "pdf", isPdf && !failed && wantThumb)
    const snippet = useTextSnippet(mount, file.path, isText && wantThumb)

    // A consistent 4:3 preview so tiles line up and nothing letterboxes oddly; visual kinds fill
    // it (object-cover), text/icon center within it. Fixed aspect → the tile height never depends
    // on whether the thumbnail has loaded, so the grid never reflows.
    const box =
        "flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded bg-colorFillTertiary"

    // Image — a small downscaled webp data URL; skeleton until it resolves. (Animated gifs render
    // as a static first frame — acceptable for a tile.)
    if (isImage && imgUrl && !failed) {
        return (
            <div className={box}>
                {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL; next/image can't optimize it */}
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
    if (isVideo && directUrl && !failed && wantThumb) {
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
        !failed &&
        wantThumb &&
        ((isImage && !imgUrl) || (isPdf && !pdfUrl) || (isText && snippet === null))
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
        (a.file.size ?? 0) === (b.file.size ?? 0) &&
        a.staticThumb === b.staticThumb,
)
