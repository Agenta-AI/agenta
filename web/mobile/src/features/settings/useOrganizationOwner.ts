import {useProfile} from "@agenta/entities/profile"

import {useSettingsOrg} from "./useSettingsOrg"

/**
 * Is the signed-in person the owner of this organization?
 *
 * Access & Security belongs to the owner on every plan, and the API decides it by the
 * organization's owner id, not by a permission. `pending` holds while the
 * profile or the organization is still loading, so a screen never sends the owner away before it
 * knows who they are.
 */
export const useOrganizationOwner = (workspaceId: string): {isOwner: boolean; pending: boolean} => {
    const {user, isPending: profilePending} = useProfile()
    const {org, loading: orgPending} = useSettingsOrg(workspaceId)
    const ownerId = org.data?.owner_id
    return {
        isOwner: Boolean(ownerId && user?.id && ownerId === user.id),
        pending: Boolean(profilePending || orgPending),
    }
}
