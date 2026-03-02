import {useMemo} from "react"

import {isEE} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useWorkspaceMembers} from "@/oss/state/workspace"

/**
 * Hook to check workspace-level permissions for the current user.
 * Handles both organization owner checks and workspace role-based permissions.
 */
export const useWorkspacePermissions = () => {
    const {selectedOrg} = useOrgData()
    const {user: signedInUser} = useProfileData()
    const {filteredMembers} = useWorkspaceMembers()
    const {hasRBAC} = useEntitlements()

    /**
     * Check if the current user can invite members to the workspace.
     * Only organization owners and workspace_admins can invite.
     */
    const canInviteMembers = useMemo(() => {
        if (!isEE()) return true // OSS mode - allow all
        if (!hasRBAC) return true // No RBAC - allow all

        // Check if user is organization owner
        if (selectedOrg?.owner_id && signedInUser?.id === selectedOrg.owner_id) {
            return true
        }

        const currentMember = filteredMembers.find(
            (member) =>
                member.user?.id === signedInUser?.id || member.user?.email === signedInUser?.email,
        )

        if (!currentMember) return false

        const allowedRoles = ["owner", "workspace_admin"]
        return currentMember.roles?.some((role) => allowedRoles.includes(role.role_name))
    }, [filteredMembers, signedInUser, hasRBAC, selectedOrg])

    /**
     * Check if the current user can modify roles of other workspace members.
     * Only organization owners and workspace_admins can modify roles.
     */
    const canModifyRoles = useMemo(() => {
        if (!isEE()) return false
        if (!hasRBAC) return false

        // Check if user is organization owner
        if (selectedOrg?.owner_id && signedInUser?.id === selectedOrg.owner_id) {
            return true
        }

        const currentUserMember = selectedOrg?.default_workspace?.members?.find(
            (m) => m.user?.id === signedInUser?.id || m.user?.email === signedInUser?.email,
        )

        if (!currentUserMember) return false

        const allowedRoles = ["owner", "workspace_admin"]
        return currentUserMember.roles?.some((r: any) => allowedRoles.includes(r.role_name))
    }, [signedInUser, hasRBAC, selectedOrg])

    /**
     * Check if the current user is the organization owner.
     */
    const isOrgOwner = useMemo(() => {
        return Boolean(selectedOrg?.owner_id && signedInUser?.id === selectedOrg.owner_id)
    }, [selectedOrg, signedInUser])

    return {
        canInviteMembers,
        canModifyRoles,
        isOrgOwner,
    }
}
