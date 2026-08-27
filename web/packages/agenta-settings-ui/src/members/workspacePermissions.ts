/**
 * Who may invite and remove, from the roster the members page already has.
 *
 * The desktop answers this from `web/oss/src/hooks/useWorkspacePermissions`, which is built on
 * oss-only jotai stores and cannot be imported by another host. The RULE lives here so the two
 * surfaces cannot drift; oss's hook should be refactored onto it rather than a third copy being
 * written.
 */

import type {WorkspaceMember} from "@agenta/entities/organization"

export interface WorkspacePermissionInput {
    /** The workspace roster. The viewer's own row carries their roles and permissions. */
    members: WorkspaceMember[]
    /** The signed-in user, matched on id then email — the desktop matches on either. */
    user: {id?: string | null; email?: string | null} | null
    /** The organization owner, who is above the role system. */
    ownerId?: string | null
    /** OSS always enforces RBAC; EE only when the plan includes it. */
    rbacActive: boolean
    /** False while the roster or the entitlement is still in flight — every verb stays off. */
    ready: boolean
}

export interface WorkspacePermissions {
    canInviteMembers: boolean
    canModifyRoles: boolean
    canRemoveMembers: boolean
    isOrgOwner: boolean
}

export const CLOSED_WORKSPACE_PERMISSIONS: WorkspacePermissions = {
    canInviteMembers: false,
    canModifyRoles: false,
    canRemoveMembers: false,
    isOrgOwner: false,
}

export const resolveWorkspacePermissions = ({
    members,
    user,
    ownerId,
    rbacActive,
    ready,
}: WorkspacePermissionInput): WorkspacePermissions => {
    // Unlike the desktop, an unresolved answer is a NO rather than the not-enforced yes. Both
    // settle the same; only this one cannot flash a control the viewer may not use.
    if (!ready) return CLOSED_WORKSPACE_PERMISSIONS

    const isOrgOwner = Boolean(ownerId && user?.id && user.id === ownerId)

    const member =
        members.find(
            (entry) =>
                (user?.id && entry.user?.id === user.id) ||
                (user?.email && entry.user?.email === user.email),
        ) ?? null

    const permissions = new Set(
        member?.roles?.flatMap((role) => role.permissions ?? []).filter(Boolean) ?? [],
    )
    const roles = new Set(member?.roles?.map((role) => role.role_name).filter(Boolean) ?? [])

    const hasPermission = (permission: string) => {
        if (!rbacActive || isOrgOwner) return true
        return permissions.has("*") || permissions.has(permission)
    }
    const hasRole = (role: string) => {
        if (!rbacActive || isOrgOwner) return true
        return roles.has(role)
    }

    return {
        isOrgOwner,
        canInviteMembers: hasPermission("add_new_user_to_workspace"),
        // The one verb RBAC has to be on for — without it nobody edits roles.
        canModifyRoles: rbacActive ? hasPermission("modify_user_roles") : false,
        // Mirrors the backend gate on DELETE /workspaces/{id}/users.
        canRemoveMembers: hasRole("owner") || hasRole("admin"),
    }
}
