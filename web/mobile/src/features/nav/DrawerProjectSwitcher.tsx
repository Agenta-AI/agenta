import {useMemo, useState} from "react"

import {ProjectOrgSwitcherView, type SwitcherEntry} from "@agenta/navigation-ui"
import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {fetchProjects, writeLastContext} from "@/lib/context"

import {useLogout} from "../auth/useLogout"
import {groupByWorkspace} from "../context/workspaceGroups"

/**
 * The drawer's header switcher — the same designed component as the desktop rail, bound to
 * mobile's workspace/project data. Workspaces stand in for organizations (mobile has no org
 * management), so the second panel switches workspaces and creation stays desktop-only.
 */
export const DrawerProjectSwitcher = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const router = useRouter()
    const logout = useLogout()
    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })
    const groups = useMemo(
        () => (query.data?.kind === "ok" ? groupByWorkspace(query.data.projects) : []),
        [query.data],
    )

    const currentGroup = groups.find((group) => group.workspaceId === workspaceId)
    const currentProject = currentGroup?.projects.find(
        (project) => project.project_id === projectId,
    )

    const goTo = (nextWorkspaceId: string, nextProjectId: string) => {
        writeLastContext({workspaceId: nextWorkspaceId, projectId: nextProjectId})
        void router.push(`/w/${nextWorkspaceId}/p/${nextProjectId}/apps`)
    }

    const projects = useMemo<SwitcherEntry[]>(
        () =>
            (currentGroup?.projects ?? []).map((project) => ({
                key: project.project_id,
                name: project.project_name ?? "Project",
                isActive: project.project_id === projectId,
                onSelect: () => goTo(workspaceId, project.project_id),
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [currentGroup?.projects, projectId, workspaceId],
    )

    const workspaces = useMemo<SwitcherEntry[]>(
        () =>
            groups.map((group) => ({
                key: group.workspaceId,
                name: group.workspaceName,
                isActive: group.workspaceId === workspaceId,
                // Entering a workspace lands on its first project; the drawer's project panel
                // then narrows within it.
                onSelect: () => {
                    const first = group.projects[0]
                    if (first) goTo(group.workspaceId, first.project_id)
                },
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [groups, workspaceId],
    )

    const [panelContainer, setPanelContainer] = useState<HTMLElement | null>(null)

    return (
        <div ref={setPanelContainer}>
            <ProjectOrgSwitcherView
                panelContainer={panelContainer}
                collapsed={false}
                projectLabel={currentProject?.project_name ?? "Select project"}
                orgLabel={currentGroup?.workspaceName ?? "Workspace"}
                projects={projects}
                orgs={workspaces}
                orgNoun="workspace"
                onLogout={() => void logout()}
            />
        </div>
    )
}
