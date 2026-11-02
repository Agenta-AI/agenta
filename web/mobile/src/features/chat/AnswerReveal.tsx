import type {ReactNode} from "react"

import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"

import {ANSWER_ATTR} from "./useTranscriptAutoScroll"

/** A message fades in as the fold settles; `answer` marks the last one, which scroll anchors to. */
export const AnswerReveal = ({
    animate,
    answer,
    children,
}: {
    animate: boolean
    answer: boolean
    children: ReactNode
}) => {
    const presets = useMotionPresets()
    return (
        <motion.div
            {...(answer ? {[ANSWER_ATTR]: ""} : {})}
            initial={animate ? "initial" : false}
            animate="animate"
            variants={presets.crossfade}
        >
            {children}
        </motion.div>
    )
}
