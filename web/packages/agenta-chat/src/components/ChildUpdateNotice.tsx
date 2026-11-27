import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import chatQueuedMessagesDockCatalog from "@agenta/i18n/catalogs/chat.queuedMessagesDock"
import {ArrowBendDownRight} from "@phosphor-icons/react"

import type {ChildUpdate, ChildUpdateStatus} from "../assets/childUpdate"

/** One key per status, so each label is a whole phrase in every language. */
const CHILD_UPDATE_STATUS_KEYS = {
    running: "chat.queuedMessagesDock.childUpdateRunning",
    paused: "chat.queuedMessagesDock.childUpdatePaused",
    completed: "chat.queuedMessagesDock.childUpdateCompleted",
    failed: "chat.queuedMessagesDock.childUpdateFailed",
    cancelled: "chat.queuedMessagesDock.childUpdateCancelled",
    lost: "chat.queuedMessagesDock.childUpdateLost",
} as const satisfies Record<ChildUpdateStatus, string>

/**
 * A child update, as a notice rather than as the person's message: it names the child session
 * (the host renders the link) and what the child did. Read from the server's structured part
 * only; its message text is for the model and never shows here. The queue row and the transcript
 * row both use it.
 */
export const ChildUpdateNotice = ({
    update,
    renderChildSession,
    className = "",
}: {
    update: ChildUpdate | undefined
    renderChildSession?: (update: ChildUpdate) => ReactNode
    className?: string
}) => {
    const t = useT(chatQueuedMessagesDockCatalog)
    const label = t("chat.queuedMessagesDock.childUpdateFrom")
    const link = update && renderChildSession ? renderChildSession(update) : null
    return (
        <span className={`flex min-w-0 items-center gap-1.5 text-meta ${className}`}>
            {/* Labelled only beside the link; without one, the text below says the same. */}
            <ArrowBendDownRight
                size={12}
                {...(link ? {role: "img", "aria-label": label} : {"aria-hidden": true})}
                className="shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 truncate text-foreground">{link ?? label}</span>
            {update?.status ? (
                <span className="shrink-0 text-muted-foreground">
                    {t(CHILD_UPDATE_STATUS_KEYS[update.status])}
                </span>
            ) : null}
        </span>
    )
}
