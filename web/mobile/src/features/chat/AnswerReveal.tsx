import type {ReactNode} from "react"

import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"

/** The answer fades in as the fold settles, so the reply arrives instead of popping. */
export const AnswerReveal = ({animate, children}: {animate: boolean; children: ReactNode}) => {
    const presets = useMotionPresets()
    return (
        <motion.div
            initial={animate ? "initial" : false}
            animate="animate"
            variants={presets.crossfade}
        >
            {children}
        </motion.div>
    )
}
