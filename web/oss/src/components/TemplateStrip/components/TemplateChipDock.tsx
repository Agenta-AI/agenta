import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {type AgentTemplate} from "@/oss/components/pages/agent-home/assets/templates"

import TemplateChip from "./TemplateChip"

interface TemplateChipDockProps {
    template: AgentTemplate
    /** Whether a template is currently selected — drives the fade/rise in and out. */
    visible: boolean
    onClear: () => void
}

// No-bounce spring so the rise settles without overshoot (the chip seams onto the composer edge).
const ENTRANCE = {type: "spring", visualDuration: 0.3, bounce: 0} as const

/** Docks the chip and fades/rises it on mount/unmount (TemplateChip owns the width morph). */
const TemplateChipDock = ({template, visible, onClear}: TemplateChipDockProps) => (
    <MotionConfig reducedMotion="user">
        <AnimatePresence>
            {visible && (
                <motion.div
                    key="template-chip"
                    className="origin-bottom-left"
                    initial={{opacity: 0, y: 4}}
                    animate={{opacity: 1, y: 0}}
                    exit={{opacity: 0, y: 4}}
                    transition={ENTRANCE}
                >
                    <TemplateChip template={template} onClear={onClear} />
                </motion.div>
            )}
        </AnimatePresence>
    </MotionConfig>
)

export default TemplateChipDock
