import {personName, useSharingPerson} from "@agenta/sessions-ui/sharing"

import {useSessionHeader} from "./useSessionHeader"

/**
 * The open session's sharing state for this reader, and its owner's display name. Read from the
 * session row the screen already fetches (`useSessionHeader`): no sharing request when a chat
 * opens. The owner's name is read only for a reader who is not the owner (the chip names them).
 * The Share dialog reads the full state (grants and disclosure) itself.
 */
export const useSessionSharing = (sessionId: string, projectId: string) => {
    const query = useSessionHeader(projectId, sessionId)
    const sharing = query.data?.sharing ?? undefined
    const ownerId = sharing?.policy.owner_user_id ?? null
    const owner = useSharingPerson(sharing && sharing.my_role !== "owner" ? ownerId : null)
    return {
        query,
        sharing,
        ownerId,
        owner,
        ownerName: personName(owner),
    }
}
