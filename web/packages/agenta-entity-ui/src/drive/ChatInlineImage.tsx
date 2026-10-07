/**
 * An image the agent names in its reply, shown under the paragraph that names it: a downscaled
 * preview (never the full bytes) with Expand and Download in its corner. The link in the sentence
 * stays and names the file; this is the picture that goes with it.
 */
import {type ReactNode} from "react"

import {mountFileThumbnailQueryFamily} from "@agenta/entities/drive"
import {ArrowsOut, DownloadSimple} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {
    CHAT_IMAGE_PREVIEW_PX,
    isPreviewableImage,
    recordIndexAtomFamily,
    useInView,
    useMountResolver,
} from "./chatFileLookup"
import {chatFileResolver, fileCandidate, knownFromRecords} from "./chatFileRefs"
import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"
import {mediaViewerAtom} from "./MediaViewer"
import {useDriveFileDownload} from "./useDriveFileDownload"

/** The image: never wider than this, never taller than `MAX_HEIGHT`, never past its own size. */
const MAX_WIDTH = 320
const MAX_HEIGHT = 360
/** The smallest box that still holds both corner buttons; a tinier image centers inside it. */
const MIN_FRAME = 64

/** Shown on hover or keyboard focus where hovering exists; always shown on touch. */
const CORNER_ACTIONS =
    "absolute right-1.5 top-1.5 flex gap-1 transition-opacity motion-reduce:transition-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/inline-image:opacity-100 [@media(hover:hover)]:group-has-[:focus-visible]/inline-image:opacity-100"

const CORNER_BUTTON =
    "flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-black/55 p-0 text-white transition-colors hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"

export function ChatInlineImage({candidate}: {candidate: string}) {
    const sessionId = useDriveSessionId() ?? ""
    const artifactId = useDriveArtifactId()
    const known = knownFromRecords(useAtomValue(recordIndexAtomFamily(sessionId)), candidate)
    const target = useMountResolver(sessionId, artifactId)(candidate)
    const [ref, inView] = useInView<HTMLDivElement>()
    const enabled = inView && Boolean(target)
    const preview = useAtomValue(
        mountFileThumbnailQueryFamily({
            mountId: enabled ? (target?.mount.id ?? "") : "",
            path: enabled ? (target?.path ?? "") : "",
            px: CHAT_IMAGE_PREVIEW_PX,
        }),
    )
    const download = useDriveFileDownload()
    const openViewer = useSetAtom(mediaViewerAtom)
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
                className={
                    holding
                        ? "my-2 aspect-[4/3] w-full max-w-[320px] rounded-lg bg-colorFillTertiary motion-safe:animate-pulse"
                        : "h-0"
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
    const width = Math.min(MAX_WIDTH, data.width, (MAX_HEIGHT * data.width) / data.height)
    return (
        <figure
            className="group/inline-image relative mx-0 my-2 flex max-w-full items-center justify-center overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorFillTertiary"
            style={{width: Math.max(MIN_FRAME, width), minHeight: MIN_FRAME}}
        >
            <button
                type="button"
                aria-label={`Expand ${name}`}
                onClick={expand}
                className="flex max-w-full cursor-zoom-in border-0 bg-transparent p-0"
            >
                {/* A generated data URL; next/image cannot optimize it. */}
                <img
                    src={data.src}
                    alt={name}
                    width={data.width}
                    height={data.height}
                    draggable={false}
                    className="block h-auto max-w-full"
                    style={{width, aspectRatio: `${data.width} / ${data.height}`}}
                />
            </button>
            <div className={CORNER_ACTIONS}>
                <button
                    type="button"
                    aria-label={`Expand ${name}`}
                    onClick={expand}
                    className={CORNER_BUTTON}
                >
                    <ArrowsOut size={14} />
                </button>
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
        if (!candidate || !isPreviewableImage(candidate)) continue
        const target = resolveMount(candidate)
        const file = target
            ? `${target.mount.id}:${target.path}`
            : candidate.replace(/^(?:\.\/|\/)+/, "")
        if (!byFile.has(file)) byFile.set(file, candidate)
    }
    return (
        <>
            {[...byFile].map(([file, candidate]) => (
                <ChatInlineImage key={file} candidate={candidate} />
            ))}
        </>
    )
}

/** {@link chatFileResolver} plus inline image previews, for an agent's reply. */
export const chatReplyFileResolver = {
    ...chatFileResolver,
    renderFollowUps: (values: string[]): ReactNode => <ChatImageFollowUps values={values} />,
}
