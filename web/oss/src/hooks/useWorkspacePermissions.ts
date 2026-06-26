import {useMemo} from "react"

import {isEE} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"

import {useProjectPermissions} from "./useProjectPermissions"

/**
 * Hook to check workspace-level permissions for the current user.
 * Handles both organization owner checks and workspace role-based permissions.
 */
export const useWorkspacePermissions = () => {
    const {hasRBAC} = useEntitlements()
    const {hasPermission, isOrgOwner} = useProjectPermissions()

    // OSS always enforces; EE only when RBAC-entitled.
    const rbacActive = !isEE() || hasRBAC

    /**
     * Check if the current user can invite members to the workspace.
     */
    const canInviteMembers = useMemo(() => {
        if (!rbacActive) return true
        return hasPermission("add_new_user_to_workspace")
    }, [hasPermission, rbacActive])

    /**
     * Check if the current user can modify roles of other workspace members.
     */
    const canModifyRoles = useMemo(() => {
        if (!rbacActive) return false
        return hasPermission("modify_user_roles")
    }, [hasPermission, rbacActive])

    /**
     * Check if the current user is the organization owner.
     */
    return {
        canInviteMembers,
        canModifyRoles,
        isOrgOwner,
    }
}
