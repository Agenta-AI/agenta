import {type SessionRowStatusMeta} from "@agenta/sessions/row"
import {ChatCircleIcon, ClockIcon} from "@phosphor-icons/react"
import clsx from "clsx"

import {Tip} from "./assets/Tip"

/**
 * A glyph for the KIND of row, with the status as a dot on its shoulder. Two lists in the same
 * column read as one long list when every row leads with the same dot; the clock and the chat
 * bubble separate them without a heading.
 */
export const SessionStatusIcon = ({
    status,
    automation = false,
}: {
    status: SessionRowStatusMeta
    /** Automation runs lead with a clock, your own conversations with a chat bubble. */
    automation?: boolean
}) => (
    <Tip title={status.label}>
        <span
            aria-label={status.label}
            className="relative mt-0.5 flex shrink-0 text-colorTextTertiary"
        >
            {automation ? <ClockIcon size={18} /> : <ChatCircleIcon size={18} />}
            <span
                className={clsx(
                    "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-solid border-colorBgContainer",
                    status.dotClassName,
                    status.pulse && "motion-safe:animate-pulse",
                )}
            />
        </span>
    </Tip>
)
