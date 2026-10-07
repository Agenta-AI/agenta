/**
 * An image the agent names in its reply, shown under the paragraph that names it: a downscaled
 * preview (never the full bytes) with a caption bar to expand it into the media viewer or download
 * it. The link in the sentence stays; this is the picture that goes with it.
 */
import {useState, type ReactNode} from "react"

import {humanSize, mountFileThumbnailQueryFamily} from "@agenta/entities/drive"
import {Button} from "@agenta/ui/ui"
import {ArrowsOut, DownloadSimple} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {
    CHAT_IMAGE_PREVIEW_PX,
    isPreviewableImage,
    recordIndexAtomFamily,
    useInView,
    useMountResolver,
} from "./chatFileLookup"
import {chatFileResolver, fileCandidate, knownFromRecords} from "./chatFileRefs"
import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"
import {MediaViewer} from "./MediaViewer"
import {useDriveFileDownload} from "./useDriveFileDownload"

/** The preview's box: never wider than this, never taller than `MAX_HEIGHT`. */
const MAX_WIDTH = 320
const MAX_HEIGHT = 360

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
    const [viewing, setViewing] = useState<number | null>(null)
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

    const width = Math.min(MAX_WIDTH, data.width, (MAX_HEIGHT * data.width) / data.height)
    return (
        <figure
            className="mx-0 my-2 max-w-full overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary"
            style={{width}}
        >
            <button
                type="button"
                aria-label={`Expand ${name}`}
                onClick={() => setViewing(0)}
                className="block w-full cursor-zoom-in border-0 bg-transparent p-0"
            >
                {/* A generated data URL; next/image cannot optimize it. */}
                <img
                    src={data.src}
                    alt={name}
                    width={data.width}
                    height={data.height}
                    draggable={false}
                    className="block h-auto w-full"
                    style={{aspectRatio: `${data.width} / ${data.height}`}}
                />
            </button>
            <figcaption className="flex min-w-0 items-center gap-0.5 border-0 border-t border-solid border-colorBorderSecondary py-0.5 pl-2 pr-0.5 text-xs leading-5 text-colorTextSecondary">
                <span className="min-w-0 flex-1 truncate" title={candidate}>
                    {name} · {humanSize(data.bytes)}
                </span>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Expand ${name}`}
                    onClick={() => setViewing(0)}
                >
                    <ArrowsOut />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Download ${name}`}
                    onClick={() => void download(target.mount, target.path)}
                >
                    <DownloadSimple />
                </Button>
            </figcaption>
            <MediaViewer
                items={[
                    {
                        key: candidate,
                        name,
                        size: data.bytes,
                        source: {kind: "mount", mount: target.mount, path: target.path},
                    },
                ]}
                index={viewing}
                onIndexChange={setViewing}
            />
        </figure>
    )
}

/** The previews for one paragraph's mentions: previewable images only, once each. */
function ChatImageFollowUps({values}: {values: string[]}) {
    const candidates = new Set<string>()
    for (const value of values) {
        const candidate = fileCandidate(value)
        if (candidate && isPreviewableImage(candidate)) candidates.add(candidate)
    }
    return (
        <>
            {[...candidates].map((candidate) => (
                <ChatInlineImage key={candidate} candidate={candidate} />
            ))}
        </>
    )
}

/** {@link chatFileResolver} plus inline image previews, for an agent's reply. */
export const chatReplyFileResolver = {
    ...chatFileResolver,
    renderFollowUps: (values: string[]): ReactNode => <ChatImageFollowUps values={values} />,
}
