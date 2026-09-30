import type {TemplateExampleSession} from "@agenta/entities/workflow"
import {useRef} from "react"

import {Badge} from "@agenta/ui/ui"
import {CheckIcon} from "@phosphor-icons/react"
import {motion, useInView} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {SectionLabel} from "./SectionLabel"
import {useRunLoop} from "./useRunLoop"

const DIM = 0.2

/** A template's authored example run, playing on a loop while it is on screen. */
export const ExampleRun = ({
    example,
    active = true,
    loop = true,
    compact = false,
    className,
}: {
    example: TemplateExampleSession
    /** False pauses the loop, e.g. on a featured slide that is not showing. */
    active?: boolean
    /** False plays the run once and holds it, when something else sets the pace. */
    loop?: boolean
    /** The featured card's size: smaller type, the reply cut to two lines, no caption. */
    compact?: boolean
    className?: string
}) => {
    const presets = useMotionPresets()
    const ref = useRef<HTMLElement>(null)
    const inView = useInView(ref)
    const {revealed, fading, onFaded} = useRunLoop(example.steps.length, active && inView, loop)
    const shown = (beat: number) => (beat < revealed ? 1 : DIM)

    return (
        <section
            ref={ref}
            aria-label="Example run"
            className={cn(
                "box-border flex flex-col gap-2 rounded-lg border border-solid border-border bg-card p-4",
                className,
            )}
        >
            <div className="flex min-h-6 items-center justify-between gap-2">
                <SectionLabel>Example run</SectionLabel>
                {example.status ? (
                    <span className="text-muted-foreground text-xs">{example.status}</span>
                ) : null}
            </div>
            <motion.div
                initial={false}
                animate={{opacity: fading ? 0 : 1}}
                transition={presets.crossfadeTransition}
                onAnimationComplete={onFaded}
                className="flex flex-col gap-2"
            >
                <p
                    className={cn(
                        "m-0 font-medium text-foreground",
                        compact ? "text-xs" : "text-sm",
                    )}
                >
                    {example.prompt}
                </p>
                <ol className="m-0 flex list-none flex-col p-0">
                    {example.steps.map((step, index) => (
                        <motion.li
                            key={index}
                            initial={false}
                            animate={{opacity: shown(index)}}
                            transition={presets.crossfadeTransition}
                            className={cn(
                                "text-muted-foreground grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5",
                                compact ? "text-xs leading-4" : "text-sm leading-5",
                            )}
                        >
                            <span aria-hidden className="flex flex-col items-center">
                                <span className="box-border flex size-4 shrink-0 items-center justify-center rounded-full border border-solid border-border bg-background text-foreground">
                                    <CheckIcon weight="bold" className="size-2.5" />
                                </span>
                                {index < example.steps.length - 1 ? (
                                    <span className="w-px flex-1 bg-border" />
                                ) : null}
                            </span>
                            <span className={compact ? "pb-2" : "-mt-0.5 pb-2.5"}>{step}</span>
                        </motion.li>
                    ))}
                </ol>
                <motion.p
                    initial={false}
                    animate={{opacity: revealed > example.steps.length ? 1 : 0}}
                    transition={presets.crossfadeTransition}
                    className={cn(
                        "m-0 mt-1 border-x-0 border-b-0 border-t border-dashed border-border pt-2 text-foreground",
                        compact ? "line-clamp-2 text-xs" : "text-sm leading-relaxed",
                    )}
                >
                    {example.reply}
                </motion.p>
            </motion.div>
            {example.artifacts?.length && !compact ? (
                <ul
                    aria-label="Files it wrote"
                    className="m-0 flex list-none flex-wrap gap-1.5 p-0"
                >
                    {example.artifacts.map((artifact) => (
                        <li key={artifact}>
                            <Badge className="font-mono">{artifact}</Badge>
                        </li>
                    ))}
                </ul>
            ) : null}
            {compact ? null : (
                <span className="text-muted-foreground text-xs">
                    An example of how this template runs, not a recorded session.
                </span>
            )}
        </section>
    )
}
