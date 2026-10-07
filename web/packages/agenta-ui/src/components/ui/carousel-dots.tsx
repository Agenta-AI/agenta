import * as React from "react"

import {cn} from "./utils"

/** CarouselDots — a slide pager: a muted dot per slide, a pill for the current one, 24px targets. */
export interface CarouselDotsProps extends Omit<React.ComponentProps<"div">, "onSelect"> {
    count: number
    index: number
    onSelect: (index: number) => void
    /** The accessible name of each dot, e.g. the slide's title. */
    labels: string[]
    /** Names the group, e.g. "Featured templates". */
    label: string
    /** Fill the current pill over this many ms, then call `onProgressEnd`; 0 or absent draws it solid. */
    progressMs?: number
    /** Holds the fill where it is. */
    progressPaused?: boolean
    /** The fill finished: the one clock a carousel advances on. */
    onProgressEnd?: () => void
}

function CarouselDots({
    count,
    index,
    onSelect,
    labels,
    label,
    progressMs = 0,
    progressPaused = false,
    onProgressEnd,
    className,
    ...props
}: CarouselDotsProps) {
    const fillRef = React.useRef<HTMLSpanElement>(null)
    const animationRef = React.useRef<Animation | null>(null)
    const endRef = React.useRef(onProgressEnd)
    const [run, setRun] = React.useState(0)
    endRef.current = onProgressEnd

    // A new slide, or a click on any dot, starts the fill from empty.
    React.useEffect(() => {
        const fill = fillRef.current
        if (!fill || !progressMs) return
        const animation = fill.animate([{transform: "scaleX(0)"}, {transform: "scaleX(1)"}], {
            duration: progressMs,
            easing: "linear",
            fill: "forwards",
        })
        animation.onfinish = () => endRef.current?.()
        animationRef.current = animation
        return () => {
            animation.onfinish = null
            animation.cancel()
        }
    }, [index, progressMs, run])

    React.useEffect(() => {
        const animation = animationRef.current
        if (!animation || animation.playState === "finished") return
        if (progressPaused) animation.pause()
        else animation.play()
    }, [progressPaused, index, run])

    return (
        <div
            data-slot="carousel-dots"
            role="group"
            aria-label={label}
            className={cn("flex items-center", className)}
            {...props}
        >
            {Array.from({length: count}, (_, dot) => {
                const current = dot === index
                return (
                    <button
                        key={dot}
                        type="button"
                        aria-label={labels[dot]}
                        aria-pressed={current}
                        onClick={() => {
                            onSelect(dot)
                            setRun((value) => value + 1)
                        }}
                        className="flex h-6 min-w-3 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent px-[3px] outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--ag-controlOutline)]"
                    >
                        <span
                            aria-hidden
                            className={cn(
                                "relative block h-1.5 overflow-hidden rounded-full transition-opacity motion-reduce:transition-none",
                                current
                                    ? progressMs
                                        ? "w-[22px] bg-muted-foreground/40"
                                        : "w-[22px] bg-foreground"
                                    : "w-1.5 bg-muted-foreground opacity-40",
                            )}
                        >
                            {current && progressMs ? (
                                <span
                                    ref={fillRef}
                                    className="absolute inset-0 origin-left scale-x-0 bg-foreground"
                                />
                            ) : null}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

export {CarouselDots}
