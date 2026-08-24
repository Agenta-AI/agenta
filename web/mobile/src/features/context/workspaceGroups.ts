import type {MobileProject} from "@/lib/context"

export interface WorkspaceGroup {
    workspaceId: string
    workspaceName: string
    /** The owning organization's name — what the switcher displays, matching the desktop. */
    organizationName?: string
    projects: MobileProject[]
}

/** Group the flat project list by workspace, preserving the server's order within each. */
export const groupByWorkspace = (projects: MobileProject[]): WorkspaceGroup[] => {
    const byWorkspace = new Map<string, WorkspaceGroup>()
    for (const project of projects) {
        // A project with no workspace cannot be routed to (`/w/:id/p/:id`), so it is dropped.
        if (!project.workspace_id) continue
        const group = byWorkspace.get(project.workspace_id) ?? {
            workspaceId: project.workspace_id,
            workspaceName: project.workspace_name ?? "Workspace",
            organizationName: project.organization_name ?? undefined,
            projects: [],
        }
        group.projects.push(project)
        byWorkspace.set(project.workspace_id, group)
    }
    return [...byWorkspace.values()]
}

export interface OrganizationGroup {
    organizationId: string
    organizationName: string
    /** Workspace to enter when this org is picked — the first one the server listed. */
    workspaceId: string
    /** Every project in the org, across all its workspaces, in server order. */
    projects: MobileProject[]
}

/**
 * Group the flat project list by ORGANIZATION — what the switcher offers, matching the desktop
 * rail. Grouping by workspace instead rendered one indistinguishable "Default" row per org,
 * because every org's default workspace carries that same name.
 */
export const groupByOrganization = (projects: MobileProject[]): OrganizationGroup[] => {
    const byOrganization = new Map<string, OrganizationGroup>()
    for (const project of projects) {
        // A project with no workspace cannot be routed to (`/w/:id/p/:id`), so it is dropped.
        if (!project.workspace_id) continue
        // An org-less row still belongs to somebody: key it by workspace rather than drop it.
        const key = project.organization_id ?? `workspace:${project.workspace_id}`
        const group = byOrganization.get(key) ?? {
            organizationId: key,
            organizationName: project.organization_name ?? project.workspace_name ?? "Organization",
            workspaceId: project.workspace_id,
            projects: [],
        }
        group.projects.push(project)
        byOrganization.set(key, group)
    }
    return [...byOrganization.values()]
}
