import {useCallback, useMemo} from "react"

import {isEE} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"

type ProjectPermission = string
type ProjectRole = string

export const useProjectPermissions = () => {
    const {selectedOrg} = useOrgData()
    const {user: signedInUser} = useProfileData()
    const {hasRBAC} = useEntitlements()

    const isOrgOwner = useMemo(() => {
        return Boolean(selectedOrg?.owner_id && signedInUser?.id === selectedOrg.owner_id)
    }, [selectedOrg?.owner_id, signedInUser?.id])

    const currentMember = useMemo(() => {
        const members = selectedOrg?.default_workspace?.members ?? []

        return (
            members.find(
                (member) =>
                    member.user?.id === signedInUser?.id || member.user?.email === signedInUser?.email,
            ) ?? null
        )
    }, [selectedOrg?.default_workspace?.members, signedInUser?.email, signedInUser?.id])

    const permissions = useMemo(() => {
        return new Set(
            currentMember?.roles?.flatMap((role) => role.permissions ?? []).filter(Boolean) ?? [],
        )
    }, [currentMember?.roles])

    const roles = useMemo(() => {
        return new Set(currentMember?.roles?.map((role) => role.role_name).filter(Boolean) ?? [])
    }, [currentMember?.roles])

    const hasPermission = useCallback(
        (permission: ProjectPermission) => {
            if (!isEE() || !hasRBAC) return true
            if (isOrgOwner) return true
            return permissions.has(permission)
        },
        [hasRBAC, isOrgOwner, permissions],
    )

    const hasRole = useCallback(
        (role: ProjectRole) => {
            if (role === "owner") return isOrgOwner
            return roles.has(role)
        },
        [isOrgOwner, roles],
    )

    return {
        currentMember,
        hasPermission,
        hasRole,
        isOrgOwner,
        canViewApiKeys: hasPermission("view_api_keys"),
        canEditApiKeys: hasPermission("edit_api_keys"),
    }
}
