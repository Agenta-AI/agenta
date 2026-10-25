import type {Visibility} from "@agenta/entities/sharing"
import {userAtom} from "@agenta/shared/state"
import {SimpleTooltip} from "@agenta/ui/ui"
import {LockSimpleIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {sessionSharingCopy as copy} from "./copy"
import {personName} from "./people"
import {useSharingPerson} from "./useSharingPerson"

export interface SessionPrivacyMarkerProps {
    visibility?: Visibility | null
    ownerUserId?: string | null
    /** Also show "Shared by {owner}" on a chat someone shared with you (list rows, not tabs). */
    showSharedBy?: boolean
}

/**
 * The lock after a session title that marks a private chat. No marker = project-visible.
 * The owner's own private chat says so; a chat someone shared with you names who did.
 */
export const SessionPrivacyMarker = (props: SessionPrivacyMarkerProps) => {
    if (props.visibility !== "private" || !props.ownerUserId) return null
    return <PrivateMarker {...props} ownerUserId={props.ownerUserId} />
}

/** Split out so the member read only runs for a row that is private. */
const PrivateMarker = ({
    ownerUserId,
    showSharedBy = false,
}: SessionPrivacyMarkerProps & {ownerUserId: string}) => {
    const me = useAtomValue(userAtom)
    const mine = Boolean(me?.id) && me?.id === ownerUserId
    const owner = useSharingPerson(mine ? null : ownerUserId)
    const ownerName = personName(owner)
    const tooltip = mine ? copy.lockOwner : ownerName ? copy.lockShared(ownerName) : undefined

    return (
        <>
            <SimpleTooltip title={tooltip}>
                <span
                    className="inline-flex shrink-0 items-center text-muted-foreground"
                    data-testid="session-private-marker"
                >
                    <LockSimpleIcon size={12} aria-label={tooltip} />
                </span>
            </SimpleTooltip>
            {showSharedBy && !mine && ownerName ? (
                <span className="shrink-0 truncate rounded-full bg-muted px-1.5 text-[11px] leading-4 text-muted-foreground">
                    {copy.sharedBy(ownerName)}
                </span>
            ) : null}
        </>
    )
}
