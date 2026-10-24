import {sessionSharingQueryAtomFamily} from "@agenta/entities/sharing"
import {personName, useSharingPerson} from "@agenta/sessions-ui/sharing"
import {useAtomValue} from "jotai"

/**
 * The open session's sharing state, and its owner's display name. One cached read per session
 * (the tab strip, the composer and the approval dock share it).
 */
export const useSessionSharing = (sessionId: string) => {
    const query = useAtomValue(sessionSharingQueryAtomFamily(sessionId))
    const sharing = query.data?.sharing
    const ownerId = sharing?.policy.owner_user_id ?? null
    const owner = useSharingPerson(sharing && sharing.my_role !== "owner" ? ownerId : null)
    return {
        query,
        sharing,
        disclosure: query.data?.disclosure,
        ownerId,
        owner,
        ownerName: personName(owner),
    }
}
