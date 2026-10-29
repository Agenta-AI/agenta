import {useMemo} from "react"

import {useQuery} from "@tanstack/react-query"

import {fetchProjects} from "@/lib/context"

import {groupByOrganization, type OrganizationGroup} from "../context/workspaceGroups"

/**
 * The project list grouped by organization, with the current organization and project picked
 * out. One query key and staleTime for every caller (the sidebar switcher, the Settings group
 * headers), so a screen with several of them sends one request.
 */
export const useOrganizationProjects = (workspaceId: string, projectId: string) => {
    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })
    const groups = useMemo<OrganizationGroup[]>(
        () => (query.data?.kind === "ok" ? groupByOrganization(query.data.projects) : []),
        [query.data],
    )
    // Matched on the project: the route segment can be a legacy workspace id or the
    // organization id for the same project (workspace removal step 2).
    const currentGroup =
        groups.find((group) =>
            group.projects.some((project) => project.project_id === projectId),
        ) ?? groups.find((group) => group.projects.some((p) => p.workspace_id === workspaceId))
    const currentProject = currentGroup?.projects.find(
        (project) => project.project_id === projectId,
    )
    return {query, groups, currentGroup, currentProject}
}
