import {useCallback, useMemo} from "react"

import {isEE} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"

type ProjectPermission = string
type ProjectRole = string
type CanonicalProjectRole = "owner" | "admin" | "developer" | "editor" | "annotator" | "viewer"

const FALLBACK_ROLE_PERMISSIONS: Record<CanonicalProjectRole, ProjectPermission[]> = {
    owner: ["*"],
    admin: ["view_api_keys", "edit_api_keys", "add_new_user_to_workspace", "modify_user_roles"],
    developer: ["view_api_keys", "edit_api_keys"],
    editor: [],
    annotator: [],
    viewer: [],
}

const isCanonicalProjectRole = (role: string | null | undefined): role is CanonicalProjectRole =>
    role === "owner" ||
    role === "admin" ||
    role === "developer" ||
    role === "editor" ||
    role === "annotator" ||
    role === "viewer"

export const useProjectPermissions = () => {
    const {selectedOrg, loading: orgLoading} = useOrgData()
    const {user: signedInUser} = useProfileData()
    const {project, projectId, isLoading: projectLoading} = useProjectData()
    const {hasRBAC} = useEntitlements()
    const selectedOrgId = selectedOrg?.id ?? null
    const selectedProjectId = project?.project_id ?? projectId ?? null

    const isOrgOwner = useMemo(() => {
        return Boolean(selectedOrg?.owner_id && signedInUser?.id === selectedOrg.owner_id)
    }, [selectedOrg?.owner_id, signedInUser?.id])

    const currentMember = useMemo(() => {
        if (!selectedOrgId || !selectedProjectId) return null

        if (project?.organization_id && project.organization_id !== selectedOrgId) {
            return null
        }

        const members = selectedOrg?.default_workspace?.members ?? []

        return (
            members.find(
                (member) =>
                    member.user?.id === signedInUser?.id ||
                    member.user?.email === signedInUser?.email,
            ) ?? null
        )
    }, [
        project?.organization_id,
        selectedOrg?.default_workspace?.members,
        selectedOrgId,
        selectedProjectId,
        signedInUser?.email,
        signedInUser?.id,
    ])

    const selectedProjectRole = useMemo(() => {
        if (!selectedOrgId || !selectedProjectId) return null
        if (project?.organization_id && project.organization_id !== selectedOrgId) return null

        const projectRole = project?.user_role?.trim()
        return projectRole || null
    }, [project?.organization_id, project?.user_role, selectedOrgId, selectedProjectId])

    const rolePermissions = useMemo(() => {
        if (selectedProjectRole) {
            const matchingRole = currentMember?.roles?.find(
                (role) => role.role_name === selectedProjectRole,
            )
            if (matchingRole?.permissions?.length) {
                return new Set(matchingRole.permissions.filter(Boolean))
            }

            if (isCanonicalProjectRole(selectedProjectRole)) {
                return new Set(FALLBACK_ROLE_PERMISSIONS[selectedProjectRole])
            }
        }

        return new Set(
            currentMember?.roles?.flatMap((role) => role.permissions ?? []).filter(Boolean) ?? [],
        )
    }, [currentMember?.roles, selectedProjectRole])

    const roles = useMemo(() => {
        const next = new Set(
            currentMember?.roles?.map((role) => role.role_name).filter(Boolean) ?? [],
        )
        if (selectedProjectRole) {
            next.add(selectedProjectRole)
        }
        return next
    }, [currentMember?.roles, selectedProjectRole])

    const isReady = useMemo(() => {
        return Boolean(selectedOrgId && selectedProjectId && !orgLoading && !projectLoading)
    }, [orgLoading, projectLoading, selectedOrgId, selectedProjectId])

    const hasPermission = useCallback(
        (permission: ProjectPermission) => {
            if (!isEE() || !hasRBAC) return true
            if (isOrgOwner) return true
            if (!isReady) return false
            return rolePermissions.has("*") || rolePermissions.has(permission)
        },
        [hasRBAC, isOrgOwner, isReady, rolePermissions],
    )

    const hasRole = useCallback(
        (role: ProjectRole) => {
            if (!isEE() || !hasRBAC) return true
            if (isOrgOwner) return true
            if (!isReady) return false
            if (role === "owner") {
                return selectedProjectRole === "owner" || roles.has("owner")
            }
            return roles.has(role)
        },
        [hasRBAC, isOrgOwner, isReady, roles, selectedProjectRole],
    )

    return {
        currentMember,
        hasPermission,
        hasRole,
        isOrgOwner,
        isReady,
        selectedOrgId,
        selectedProjectId,
        canExportData: hasRole("owner") || hasRole("admin") || hasRole("developer"),
        canViewApiKeys: hasPermission("view_api_keys"),
        canEditApiKeys: hasPermission("edit_api_keys"),
    }
}
