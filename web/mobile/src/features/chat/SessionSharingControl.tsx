import {SessionAccessChip, SessionShareButton} from "@agenta/sessions-ui/sharing"
import {useSetAtom} from "jotai"

import {shareDialogRequestAtom} from "./shareDialogState"
import {useSessionSharing} from "./useSessionSharing"

/**
 * This chat's sharing: "Share" for the owner, and for everyone else a chip
 * that says what they can do here and opens who has access. Ownerless chats (a channel, an API
 * key) get only the chip; the state's `not_shareable_reason` picks the channel text or the
 * no-owner texts. Nothing until the state is known, so nothing flashes a wrong verb.
 */
export const SessionSharingControl = ({
    sessionId,
    sessionName,
    workspaceId,
    projectId,
    agentId,
    onOpened,
}: {
    sessionId: string
    sessionName: string
    workspaceId: string
    projectId: string
    agentId?: string | null
    /** The Share dialog was asked for: a host panel closes itself here. */
    onOpened?: () => void
}) => {
    const {sharing, owner} = useSessionSharing(sessionId, projectId)
    const openShare = useSetAtom(shareDialogRequestAtom)
    if (!sharing) return null

    if (sharing.my_role === "owner") {
        return (
            <SessionShareButton
                sharing={sharing}
                onClick={() => {
                    openShare({sessionId, sessionName, workspaceId, projectId, agentId})
                    onOpened?.()
                }}
            />
        )
    }
    return (
        <SessionAccessChip
            sharing={sharing}
            owner={owner}
            fromChannel={sharing.not_shareable_reason === "channel"}
        />
    )
}
