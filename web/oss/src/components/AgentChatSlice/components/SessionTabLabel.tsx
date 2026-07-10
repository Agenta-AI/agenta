import {useState} from "react"

import {PencilSimple} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"

import IdentityCardPopover from "@/oss/components/EntityIdentity/IdentityCardPopover"
import InlineEditableText from "@/oss/components/EntityIdentity/InlineEditableText"
import SessionIdentityCard from "@/oss/components/EntityIdentity/SessionIdentityCard"

import {useChatScopeKey} from "../state/scope"

/**
 * A session tab's label. Two rename paths: double-click the label to rename inline (the quick,
 * everyday path — commit on Enter/blur, Escape reverts), or the pen to open the session identity
 * card (status, opening message, activity — where the title is also editable). The pen reveals on
 * tab hover/focus (and stays while its card is open) using the same opacity toggle as the tab's
 * close/delete button, so its reserved box never shifts the tab. `className` styles the resting
 * label text; the tag passes truncation + color.
 */
const SessionTabLabel = ({
    label,
    onRename,
    className,
    sessionId,
    createdAt,
}: {
    label: string
    onRename: (next: string) => void
    className?: string
    sessionId: string
    createdAt?: number
}) => {
    const scope = useChatScopeKey()
    const [cardOpen, setCardOpen] = useState(false)

    return (
        <span className="flex min-w-0 flex-1 items-center gap-1">
            <span className="flex min-w-0 flex-1 overflow-hidden">
                <InlineEditableText
                    value={label}
                    onCommit={onRename}
                    className={clsx("w-full", className)}
                />
            </span>
            <IdentityCardPopover
                open={cardOpen}
                onOpenChange={setCardOpen}
                content={
                    <SessionIdentityCard
                        sessionId={sessionId}
                        scope={scope}
                        label={label}
                        createdAt={createdAt}
                        onClose={() => setCardOpen(false)}
                    />
                }
            >
                <Button
                    type="text"
                    aria-label="Session details"
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    icon={<PencilSimple size={13} />}
                    className={clsx(
                        "!h-5 !w-5 !min-w-0 shrink-0 !p-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
                        cardOpen && "!opacity-100 text-colorText",
                    )}
                />
            </IdentityCardPopover>
        </span>
    )
}

export default SessionTabLabel
