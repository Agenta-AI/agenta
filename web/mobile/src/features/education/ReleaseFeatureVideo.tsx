import type {ReleaseFeature} from "@agenta/navigation"
import {Play} from "@phosphor-icons/react"

import {streamPlayerUrl, streamThumbnailUrl} from "./streamMedia"

/** Release clips open on a black frame, so the still is taken a moment in. */
const STILL_SECONDS = 2

/** A feature's Stream clip: a still with a Play pill until clicked, then the player. */
export const ReleaseFeatureVideo = ({
    feature,
    videoId,
    playing,
    onPlay,
}: {
    feature: ReleaseFeature
    videoId: string
    playing: boolean
    onPlay: () => void
}) => (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-solid border-colorBorderSecondary">
        {playing ? (
            <iframe
                src={streamPlayerUrl(videoId)}
                title={feature.title}
                className="block size-full border-0 bg-black"
                allow="autoplay; fullscreen; picture-in-picture"
            />
        ) : (
            <button
                type="button"
                onClick={onPlay}
                aria-label={`Play ${feature.title}`}
                className="block size-full cursor-pointer border-0 bg-black p-0"
            >
                <img
                    src={streamThumbnailUrl(videoId, STILL_SECONDS)}
                    alt=""
                    className="block size-full object-cover"
                />
                <span className="absolute bottom-4 left-4 inline-flex h-[34px] items-center gap-2 rounded-full bg-background pl-[5px] pr-[13px] text-[13px] font-medium text-foreground shadow-overlay">
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-hero-action text-hero-action-foreground">
                        <Play size={11} weight="fill" aria-hidden />
                    </span>
                    Play
                </span>
            </button>
        )}
    </div>
)
