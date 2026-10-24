import type {SessionSharingState} from "@agenta/entities/sharing"
import {Alert, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {EyeIcon, PaperPlaneTiltIcon} from "@phosphor-icons/react"

import {sessionSharingCopy as copy} from "./copy"
import {PersonAvatar, personName, type SharingPerson} from "./people"

export interface SessionAccessChipProps {
    sharing: SessionSharingState
    /** The owner's profile; absent for an ownerless chat. */
    owner?: SharingPerson | null
    /** A chat that comes from a channel (Slack). */
    fromChannel?: boolean
}

/** What a person who is not the owner sees in place of "Share": their role and who has access. */
export const SessionAccessChip = ({
    sharing,
    owner,
    fromChannel = false,
}: SessionAccessChipProps) => {
    const ownerless = !sharing.policy.owner_user_id
    const ownerName = personName(owner) || sharing.policy.owner_user_id || ""
    const canSend = sharing.can_send && !fromChannel && !ownerless

    let lines: string[]
    if (fromChannel) lines = [copy.panelChannel]
    else if (ownerless) lines = [copy.panelNoOwner]
    else if (!sharing.owner_is_active) lines = [copy.panelOwnerLeft(ownerName)]
    else {
        lines = [canSend ? copy.panelCanSend : copy.panelViewer(ownerName)]
        if (sharing.policy.visibility === "private") lines.push(copy.panelPrivate(ownerName))
    }
    const infoNote = fromChannel || ownerless || !sharing.owner_is_active

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border-0 bg-muted px-2 text-xs font-medium text-foreground [font-family:inherit] hover:bg-accent"
                >
                    {canSend ? (
                        <PaperPlaneTiltIcon size={12} aria-hidden />
                    ) : (
                        <EyeIcon size={12} aria-hidden />
                    )}
                    {canSend ? copy.chipCanSend : copy.chipViewOnly}
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-[300px] flex-col gap-2.5 p-3.5">
                <span className="text-sm font-semibold">{copy.panelTitle}</span>
                {owner && !ownerless && !fromChannel ? (
                    <div className="flex items-center gap-2">
                        <PersonAvatar person={owner} />
                        <div className="flex flex-col">
                            <span className="text-sm font-medium">{personName(owner)}</span>
                            <span className="text-xs text-muted-foreground">{copy.panelOwner}</span>
                        </div>
                    </div>
                ) : null}
                {infoNote ? (
                    <Alert type="info" showIcon role="note" message={lines[0]} />
                ) : (
                    lines.map((line, index) => (
                        <p
                            key={line}
                            className={
                                index === 0 ? "m-0 text-sm" : "m-0 text-sm text-muted-foreground"
                            }
                        >
                            {line}
                        </p>
                    ))
                )}
            </PopoverContent>
        </Popover>
    )
}
