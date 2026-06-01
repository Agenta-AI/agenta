import {useCallback, useMemo} from "react"

import {useAtomValue} from "jotai"

import {isEE} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {rolesQueryAtom} from "@/oss/state/access/atoms"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"

type ProjectPermission = string
type ProjectRole = string

export const useProjectPermissions = () => {
    const {selectedOrg, loading: orgLoading} = useOrgData()
    const {user: signedInUser} = useProfileData()
    const {project, projectId, isLoading: projectLoading} = useProjectData()
    const {hasRBAC} = useEntitlements()
    const rolesQuery = useAtomValue(rolesQueryAtom)
    const projectRoleCatalog = rolesQuery.data?.project ?? []
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

            // Member entry lacks permissions for this role — fall back to the
            // effective project role catalog from /access/roles. Avoids a stale
            // hardcoded fallback when operators define custom roles via
            // AGENTA_ACCESS_ROLES.
            const catalogRole = projectRoleCatalog.find(
                (entry) => entry.role === selectedProjectRole,
            )
            if (catalogRole?.permissions?.length) {
                return new Set(catalogRole.permissions.filter(Boolean))
            }
        }

        return new Set(
            currentMember?.roles?.flatMap((role) => role.permissions ?? []).filter(Boolean) ?? [],
        )
    }, [currentMember?.roles, projectRoleCatalog, selectedProjectRole])

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
        // Export is gated by API-key access: exporting data means producing
        // an artifact that gets consumed by API-key authenticated workflows.
        canExportData: hasPermission("view_api_keys") && hasPermission("edit_api_keys"),
        canViewApiKeys: hasPermission("view_api_keys"),
        canEditApiKeys: hasPermission("edit_api_keys"),
        // Audit Log tab visibility is a permission check (`view_events`), distinct
        // from the entitlement (`Flag.AUDIT`) that gates the page content.
        canViewEvents: hasPermission("view_events"),
    }
}
