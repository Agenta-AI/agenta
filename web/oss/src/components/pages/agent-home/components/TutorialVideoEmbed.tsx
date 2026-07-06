import {useState} from "react"

import {Tooltip} from "antd"
import clsx from "clsx"
import {Play} from "lucide-react"
import Image from "next/image"

import {TUTORIAL, type TUTORIAL_VIDEO} from "../assets/constants"

type TutorialVideo = NonNullable<typeof TUTORIAL_VIDEO>

interface TutorialVideoEmbedProps {
    video: TutorialVideo
    className?: string
}

// Diagonal placeholder while there's no real poster asset.
const posterPlaceholder =
    "repeating-linear-gradient(45deg, var(--ag-colorFillSecondary) 0, var(--ag-colorFillSecondary) 8px, transparent 8px, transparent 16px)"

/** First-run tutorial: 16:9 poster + play (in place when a url is set) + title/caption. */
const TutorialVideoEmbed = ({video, className}: TutorialVideoEmbedProps) => {
    const [playing, setPlaying] = useState(false)
    const canPlay = Boolean(video.url)

    return (
        <div
            className={clsx(
                "flex flex-col gap-3 rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] p-3",
                className,
            )}
        >
            <div className="relative aspect-video overflow-hidden rounded-md bg-[var(--ag-colorFillTertiary)]">
                {playing && video.url ? (
                    <iframe
                        src={video.url}
                        title={TUTORIAL.title}
                        allow="autoplay; encrypted-media; fullscreen"
                        className="absolute inset-0 h-full w-full border-0"
                    />
                ) : (
                    <>
                        {video.poster ? (
                            <Image
                                src={video.poster}
                                alt=""
                                fill
                                className="object-cover"
                                unoptimized
                            />
                        ) : (
                            <div
                                className="absolute inset-0"
                                style={{background: posterPlaceholder}}
                            />
                        )}
                        <Tooltip title={canPlay ? undefined : "Tutorial video coming soon"}>
                            <button
                                type="button"
                                onClick={() => canPlay && setPlaying(true)}
                                aria-label="Play tutorial"
                                className={clsx(
                                    "absolute inset-0 flex items-center justify-center",
                                    canPlay ? "cursor-pointer" : "cursor-default",
                                )}
                            >
                                <span className="flex size-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-transform group-hover:scale-105">
                                    <Play size={20} className="ml-0.5" fill="currentColor" />
                                </span>
                            </button>
                        </Tooltip>
                        {video.durationLabel ? (
                            <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                                {video.durationLabel}
                            </span>
                        ) : null}
                    </>
                )}
            </div>

            <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{TUTORIAL.title}</span>
                <span className="text-[11px] leading-snug text-[var(--ag-colorTextSecondary)]">
                    {TUTORIAL.caption}
                </span>
            </div>
        </div>
    )
}

export default TutorialVideoEmbed
