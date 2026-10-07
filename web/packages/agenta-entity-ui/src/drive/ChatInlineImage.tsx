import {memo, useMemo, useState, type ReactNode} from "react"

import {mountFileThumbnailQueryFamily} from "@agenta/entities/drive"
import {mountFileContentQueryFamily} from "@agenta/entities/session"
import {useInView} from "@agenta/shared/hooks"
import {DownloadSimple} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {
    CHAT_IMAGE_PREVIEW_PX,
    isInlineImage,
    isRasterImage,
    recordIndexAtomFamily,
    useMountResolver,
} from "./chatFileLookup"
import {ChatFileCode, fileCandidate, knownFromRecords} from "./chatFileRefs"
import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"
import {mediaViewerAtom} from "./MediaViewer"
import {SVG_PREVIEW_CAP, useSvgImage} from "./svgPreview"
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

/** The box an SVG holds until it loads, and keeps when it has no size of its own. */
const SVG_FALLBACK_SIZE = {width: 320, height: 240}

/** An SVG's preview from the text read that also confirms its link. */
function useSvgPreview(file: {mountId: string; path: string}) {
    const read = useAtomValue(mountFileContentQueryFamily(file))
    const text = typeof read.data === "string" ? read.data : null
    const image = useSvgImage(text)
    const src = image?.src
    const bytes = image?.bytes ?? 0
    const data = useMemo(
        () => (text !== null && src ? {src, bytes, ...SVG_FALLBACK_SIZE, svg: true} : null),
        [text, src, bytes],
    )
    // Over the cap there is text but no picture: settled, and the mention stays a link.
    return {
        data,
        isPending: read.isPending || (text !== null && !image && text.length <= SVG_PREVIEW_CAP),
    }
}

function ChatInlineImageImpl({candidate}: {candidate: string}) {
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
        // Only a file the agent wrote holds a placeholder; an unverified mention shows nothing.
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
    // An SVG sizes from the browser; 300 x 150 is its stand-in for an SVG with no size.
    const sizeless = "svg" in data && natural?.width === 300 && natural.height === 150
    const loaded =
        natural && natural.src === data.src && natural.width > 0 && natural.height > 0 && !sizeless
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
                    className="block object-contain"
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

export const ChatInlineImage = memo(ChatInlineImageImpl)

const isImageMention = (value: string): boolean => {
    const candidate = fileCandidate(value)
    return Boolean(candidate && isInlineImage(candidate))
}

/** One figure per file: `./a.png`, `/a.png` and `a.png` collapse on the resolved mount path. */
function ChatImageFollowUpsImpl({values}: {values: string[]}) {
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

const ChatImageFollowUps = memo(
    ChatImageFollowUpsImpl,
    (a, b) => a.values.join("\n") === b.values.join("\n"),
)

/** `chatFileResolver` plus inline image previews, for an agent's reply. */
export const chatReplyFileResolver = {
    // The reply previews its images, so their link reuses the preview read.
    renderCode: (text: string, fallback: ReactNode): ReactNode => (
        <ChatFileCode text={text} fallback={fallback} rasterCheck="preview" />
    ),
    renderFollowUps: (values: string[]): ReactNode => <ChatImageFollowUps values={values} />,
    claimsFollowUp: isImageMention,
}
