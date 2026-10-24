import {SessionAccessChip, SessionShareButton} from "@agenta/sessions-ui/sharing"
import {useSetAtom} from "jotai"

import {shareDialogRequestAtom} from "./shareDialogState"
import {useSessionSharing} from "./useSessionSharing"

/**
 * The right end of the session tab strip: "Share" for the owner, and for everyone else a chip
 * that says what they can do here and opens who has access. Ownerless chats (Slack, API keys)
 * get only the chip. Nothing until the state is known, so the strip does not flash a wrong verb.
 */
export const SessionSharingControl = ({
    sessionId,
    sessionName,
    workspaceId,
    projectId,
}: {
    sessionId: string
    sessionName: string
    workspaceId: string
    projectId: string
}) => {
    const {sharing, owner} = useSessionSharing(sessionId)
    const openShare = useSetAtom(shareDialogRequestAtom)
    if (!sharing) return null

    if (sharing.my_role === "owner") {
        return (
            <SessionShareButton
                sharing={sharing}
                onClick={() => openShare({sessionId, sessionName, workspaceId, projectId})}
            />
        )
    }
    return <SessionAccessChip sharing={sharing} owner={owner} />
}
