import {browserLiveStatusQueryAtomFamily, browserPaneOpenAtomFamily} from "@agenta/entities/browser"
import {BrowserPreviewCard} from "@agenta/entity-ui/browser"
import {isBrowserEnabled} from "@agenta/shared/api"
import {useAtom, useAtomValue} from "jotai"
import {AnimatePresence, motion, useReducedMotion} from "motion/react"

import {fadeUp} from "@/lib/motion/presets"

/** Only while the agent works: the answer ends it, the pane replaces it, an ask takes its place. */
export const showBrowserPreview = ({
    working,
    running,
    waitReason,
    paneOpen,
}: {
    working: boolean
    running?: boolean
    waitReason?: string
    paneOpen: boolean
}) => working && Boolean(running) && !waitReason && !paneOpen

export const BrowserPreviewSlot = ({sessionId, working}: {sessionId: string; working: boolean}) => {
    const reduced = useReducedMotion()
    const status = useAtomValue(browserLiveStatusQueryAtomFamily(sessionId)).data
    const [paneOpen, setPaneOpen] = useAtom(browserPaneOpenAtomFamily(sessionId))
    const show =
        isBrowserEnabled() &&
        showBrowserPreview({
            working,
            running: status?.running,
            waitReason: status?.waitReason,
            paneOpen,
        })
    return (
        <AnimatePresence>
            {show ? (
                <motion.div
                    variants={fadeUp}
                    initial={reduced ? false : "initial"}
                    animate="animate"
                    exit="exit"
                    className="-mt-6 pb-3"
                >
                    <BrowserPreviewCard sessionId={sessionId} onOpen={() => setPaneOpen(true)} />
                </motion.div>
            ) : null}
        </AnimatePresence>
    )
}
