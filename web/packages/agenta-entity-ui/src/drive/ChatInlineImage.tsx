/**
 * An image the agent names in its reply, shown under the paragraph that names it: a downscaled
 * preview (never the full bytes); a tap opens the viewer and Download sits in its corner. The
 * link in the sentence stays and names the file; this is the picture that goes with it.
 */
import {useMemo, useState, type ReactNode} from "react"

import {mountFileThumbnailQueryFamily} from "@agenta/entities/drive"
import {mountFileContentQueryFamily} from "@agenta/entities/session"
import {DownloadSimple} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {
    CHAT_IMAGE_PREVIEW_PX,
    isInlineImage,
    isRasterImage,
    recordIndexAtomFamily,
    useInView,
    useMountResolver,
} from "./chatFileLookup"
import {chatFileResolver, fileCandidate, knownFromRecords} from "./chatFileRefs"
import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"
import {mediaViewerAtom} from "./MediaViewer"
import {SVG_PREVIEW_CAP, svgDeclaresSize, svgIntrinsicSize, useSvgObjectUrl} from "./svgPreview"
import {useDriveFileDownload} from "./useDriveFileDownload"

/** The image: never wider than this, never taller than `MAX_HEIGHT`, never past its own size. */
const MAX_WIDTH = 320
const MAX_HEIGHT = 360
/** The smallest box that still holds the corner button; a tinier image centers inside it. */
const MIN_FRAME = 40

/** Shown on hover or keyboard focus where hovering exists; always shown on touch. */
const CORNER_ACTION =
    "absolute right-1.5 top-1.5 transition-opacity motion-reduce:transition-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/inline-image:opacity-100 [@media(hover:hover)]:group-has-[:focus-visible]/inline-image:opacity-100"

const CORNER_BUTTON =
    "flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-black/55 p-0 text-white transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"

/** Default box for an SVG that states no size of its own. */
const SVG_FALLBACK_SIZE = {width: 320, height: 240}

/** An SVG's preview from the same text read its link resolves with: the read succeeding is the
 * confirmation, and the picture is that text as an `image/svg+xml` blob. */
function useSvgPreview(file: {mountId: string; path: string}) {
    const read = useAtomValue(mountFileContentQueryFamily(file))
    const text = typeof read.data === "string" ? read.data : null
    const src = useSvgObjectUrl(text)
    const data = useMemo(
        () =>
            text !== null && src
                ? {
                      src,
                      bytes: new Blob([text]).size,
                      ...(svgIntrinsicSize(text) ?? SVG_FALLBACK_SIZE),
                      trustNatural: svgDeclaresSize(text),
                  }
                : null,
        [text, src],
    )
    // Over the cap there is text but no picture: settled, and the mention stays a link.
    return {
        data,
        isPending: read.isPending || (text !== null && !src && text.length <= SVG_PREVIEW_CAP),
    }
}

export function ChatInlineImage({candidate}: {candidate: string}) {
    const sessionId = useDriveSessionId() ?? ""
    const artifactId = useDriveArtifactId()
    const known = knownFromRecords(useAtomValue(recordIndexAtomFamily(sessionId)), candidate)
    const target = useMountResolver(sessionId, artifactId)(candidate)
    const [ref, inView] = useInView<HTMLDivElement>()
    const enabled = inView && Boolean(target)
    const raster = isRasterImage(candidate)
    const file = {
        mountId: enabled ? (target?.mount.id ?? "") : "",
        path: enabled ? (target?.path ?? "") : "",
    }
    const thumbnail = useAtomValue(
        mountFileThumbnailQueryFamily(
            raster ? {...file, px: CHAT_IMAGE_PREVIEW_PX} : {mountId: "", path: ""},
        ),
    )
    const svg = useSvgPreview(raster ? {mountId: "", path: ""} : file)
    const preview = raster ? thumbnail : svg
    const download = useDriveFileDownload()
    const openViewer = useSetAtom(mediaViewerAtom)
    const [natural, setNatural] = useState<{src: string; width: number; height: number} | null>(
        null,
    )
    const name = candidate.split("/").pop() ?? candidate
    const data = preview.data

    if (!data || !target) {
        // A file the agent wrote holds its space while the preview loads; an unverified mention
        // shows nothing until it proves to be an image, so a miss never flashes a placeholder.
        const holding = known && (!enabled || preview.isPending)
        return (
            <div
                ref={ref}
                aria-hidden
                data-holding={holding || undefined}
                className={
                    holding
                        ? "aspect-[4/3] w-[320px] max-w-full rounded-lg bg-colorFillTertiary motion-safe:animate-pulse"
                        : "absolute h-0 w-0"
                }
            />
        )
    }

    const expand = () =>
        openViewer({
            items: [
                {
                    key: candidate,
                    name,
                    size: data.bytes,
                    source: {kind: "mount", mount: target.mount, path: target.path},
                },
            ],
            index: 0,
        })
    // The browser's own reading of the image wins once loaded: an SVG's units can differ from
    // what the root tag parse assumed. A size-less SVG reports a stand-in, so it keeps the hint.
    const loaded =
        natural &&
        natural.src === data.src &&
        natural.width > 0 &&
        natural.height > 0 &&
        ("trustNatural" in data ? data.trustNatural : true)
            ? natural
            : data
    const width = Math.min(MAX_WIDTH, loaded.width, (MAX_HEIGHT * loaded.width) / loaded.height)
    const height = (width * loaded.height) / loaded.width
    return (
        <figure
            className="group/inline-image relative m-0 flex max-w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorFillTertiary"
            style={{minWidth: MIN_FRAME, minHeight: MIN_FRAME}}
        >
            <button
                type="button"
                aria-label={`Expand ${name}`}
                onClick={expand}
                className="flex cursor-zoom-in border-0 bg-transparent p-0"
            >
                {/* A data or object URL; next/image cannot optimize it. An SVG stays in `<img>`. */}
                <img
                    src={data.src}
                    alt={name}
                    draggable={false}
                    onLoad={(e) =>
                        setNatural({
                            src: data.src,
                            width: e.currentTarget.naturalWidth,
                            height: e.currentTarget.naturalHeight,
                        })
                    }
                    className="block"
                    style={{width, height}}
                />
            </button>
            <div className={CORNER_ACTION}>
                <button
                    type="button"
                    aria-label={`Download ${name}`}
                    onClick={() => void download(target.mount, target.path)}
                    className={CORNER_BUTTON}
                >
                    <DownloadSimple size={14} />
                </button>
            </div>
        </figure>
    )
}

/** The previews for one paragraph's mentions: previewable images only, one per file. Spellings
 * that reach the same file (`./a.png`, `/a.png`, `a.png`) collapse on the resolved mount path. */
function ChatImageFollowUps({values}: {values: string[]}) {
    const resolveMount = useMountResolver(useDriveSessionId() ?? "", useDriveArtifactId())
    const byFile = new Map<string, string>()
    for (const value of values) {
        const candidate = fileCandidate(value)
        if (!candidate || !isInlineImage(candidate)) continue
        const target = resolveMount(candidate)
        const file = target
            ? `${target.mount.id}:${target.path}`
            : candidate.replace(/^(?:\.\/|\/)+/, "")
        if (!byFile.has(file)) byFile.set(file, candidate)
    }
    // One row that wraps; its margin only once something in it shows.
    return (
        <div className="relative flex flex-wrap items-start gap-2 has-[figure]:my-2 has-[[data-holding]]:my-2">
            {[...byFile].map(([file, candidate]) => (
                <ChatInlineImage key={file} candidate={candidate} />
            ))}
        </div>
    )
}

/** {@link chatFileResolver} plus inline image previews, for an agent's reply. */
export const chatReplyFileResolver = {
    ...chatFileResolver,
    renderFollowUps: (values: string[]): ReactNode => <ChatImageFollowUps values={values} />,
}
