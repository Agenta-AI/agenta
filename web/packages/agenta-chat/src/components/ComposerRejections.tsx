import {WarningCircle, X} from "@phosphor-icons/react"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import type {AttachmentRejection} from "../assets"
import {SESSION_SPRING} from "../assets/motion"

/** Four rows, then it scrolls — a bad multi-select should not push the input down the screen. */
const MAX_HEIGHT = 108

export interface ComposerRejectionsProps {
    rejections: AttachmentRejection[]
    /** Dismiss one row by position: two files can reject with the same name AND reason. */
    onDismiss: (index: number) => void
}

/**
 * The files the composer would not take, docked above it. A warning, not an error: nothing broke
 * and nothing was lost, and the message still sends with whatever else was picked.
 *
 * Kept out of the attachment tray because a rejection is not an attachment — no thumbnail, no
 * upload, nothing to send — and sizing it like one either truncated the reason away or forced a
 * card into two lines.
 *
 * Each row still dismisses on its own, which is the part worth keeping from the card treatment.
 */
export const ComposerRejections = ({rejections, onDismiss}: ComposerRejectionsProps) => (
    <MotionConfig transition={SESSION_SPRING}>
        <div
            className="mb-2 flex flex-col gap-0.5 overflow-y-auto rounded-md border border-solid border-colorWarningBorder bg-colorWarningBg px-2 py-1.5"
            style={{maxHeight: MAX_HEIGHT}}
            role="status"
        >
            <AnimatePresence initial={false} mode="popLayout">
                {rejections.map((rejection, index) => (
                    <motion.div
                        key={`${index}-${rejection.name}`}
                        layout
                        initial={{opacity: 0, y: -4}}
                        animate={{opacity: 1, y: 0}}
                        exit={{opacity: 0, y: -4}}
                        className="flex min-w-0 items-center gap-2"
                    >
                        <WarningCircle
                            size={14}
                            weight="fill"
                            className="shrink-0 text-colorWarning"
                        />
                        <span
                            className="min-w-0 flex-1 truncate text-xs text-colorWarning"
                            title={`${rejection.name} ${rejection.reason}`}
                        >
                            <span className="font-medium">{rejection.name}</span>{" "}
                            <span className="opacity-80">{rejection.reason}</span>
                        </span>
                        <button
                            type="button"
                            aria-label={`Dismiss ${rejection.name}`}
                            onClick={() => onDismiss(index)}
                            className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-colorWarning opacity-70 transition-opacity hover:opacity-100"
                        >
                            <X size={10} weight="bold" />
                        </button>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    </MotionConfig>
)

export default ComposerRejections
