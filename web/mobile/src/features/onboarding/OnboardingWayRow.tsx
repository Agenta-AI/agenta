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
    children,
}: {
    icon: ReactNode
    title: string
    hint: string
    action: ReactNode
    /** Entrance delay in seconds, so the rows arrive one after another. */
    delay: number
    /** The brand tile, for Agenta's own credits. */
    highlight?: boolean
    /** Content that opens under the row, such as an inline form. */
    children?: ReactNode
}) => {
    const presets = useMotionPresets()
    return (
        <motion.div
            variants={presets.fadeUp}
            custom={delay}
            initial="initial"
            animate="animate"
            className="border-border flex flex-1 flex-col justify-center border-0 border-solid [&+&]:border-t"
        >
            <div className="flex items-center gap-3 py-3">
                <span
                    className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
                        highlight
                            ? "bg-selected text-foreground ring-border-strong"
                            : "bg-secondary text-muted-foreground ring-border",
                    )}
                >
                    {icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-label">{title}</span>
                    <span className="text-muted-foreground text-meta">{hint}</span>
                </span>
                <span className="shrink-0">{action}</span>
            </div>
            {children}
        </motion.div>
    )
}
