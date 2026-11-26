import type {SessionSharingState} from "@agenta/entities/sharing"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {LockSimpleIcon, UsersIcon} from "@phosphor-icons/react"

import {sessionSharingCopy as copy} from "./copy"

export interface SessionShareButtonProps {
    /** The owner's sharing state; render the button for `my_role === "owner"` only. */
    sharing: SessionSharingState
    onClick: () => void
}

const tooltipOf = (sharing: SessionSharingState): string => {
    if (!sharing.shareable) return copy.tooltipNotShareable
    if (sharing.policy.visibility === "project") return copy.tooltipProject
    if (sharing.grants.length > 0) return copy.tooltipPeople(sharing.grants.length)
    return copy.tooltipPrivate
}

/** The "Share" button at the right end of the session tab strip. */
export const SessionShareButton = ({sharing, onClick}: SessionShareButtonProps) => {
    const nobodyAdded = sharing.policy.visibility === "private" && sharing.grants.length === 0
    return (
        <SimpleTooltip title={tooltipOf(sharing)}>
            {/* A disabled button fires no pointer events, so the tooltip hangs on a wrapper. */}
            <span className="inline-flex">
                <Button variant="outline" size="sm" disabled={!sharing.shareable} onClick={onClick}>
                    {nobodyAdded ? (
                        <LockSimpleIcon size={14} aria-hidden />
                    ) : (
                        <UsersIcon size={14} aria-hidden />
                    )}
                    {copy.shareButton}
                </Button>
            </span>
        </SimpleTooltip>
    )
}
