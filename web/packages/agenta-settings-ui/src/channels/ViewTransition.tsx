import {AnimatePresence, motion, useReducedMotion} from "motion/react"

import {panelViewFade, panelViewSlide} from "../assets/motion"

export interface ViewTransitionProps {
    /** Changes when the view changes; the old view slides out as the new one slides in. */
    viewKey: string
    /** +1 when moving forward, -1 when going back. */
    direction: number
    children: React.ReactNode
}

/** Swaps one panel view for the next side by side, in the direction the user moved. */
export const ViewTransition = ({viewKey, direction, children}: ViewTransitionProps) => {
    const reduced = useReducedMotion()
    return (
        <div className="relative flex min-h-full flex-1 flex-col">
            <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                    key={viewKey}
                    custom={direction}
                    variants={reduced ? panelViewFade : panelViewSlide}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex flex-1 flex-col"
                >
                    {children}
                </motion.div>
            </AnimatePresence>
        </div>
    )
}
