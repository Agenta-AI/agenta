import type {ReactNode} from "react"

import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

/** One way to pay for runs, as a row of the Ways to pay panel: tile, what it is, its action. */
export const OnboardingWayRow = ({
    icon,
    title,
    hint,
    action,
    delay,
    highlight = false,
}: {
    icon: ReactNode
    title: string
    hint: string
    action: ReactNode
    /** Entrance delay in seconds, so the rows arrive one after another. */
    delay: number
    /** The brand tile, for Agenta's own credits. */
    highlight?: boolean
}) => {
    const presets = useMotionPresets()
    return (
        <motion.div
            variants={presets.fadeUp}
            custom={delay}
            initial="initial"
            animate="animate"
            className="border-border flex flex-1 items-center gap-3 border-0 border-solid py-3 [&+&]:border-t"
        >
            <span
                className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
                    highlight
                        ? "bg-hero-action text-hero-action-foreground ring-hero-action-foreground/10"
                        : "bg-background text-foreground ring-border",
                )}
            >
                {icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium leading-5">{title}</span>
                <span className="text-muted-foreground text-xs leading-4">{hint}</span>
            </span>
            <span className="shrink-0">{action}</span>
        </motion.div>
    )
}
