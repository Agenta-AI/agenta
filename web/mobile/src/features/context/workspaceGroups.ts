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
