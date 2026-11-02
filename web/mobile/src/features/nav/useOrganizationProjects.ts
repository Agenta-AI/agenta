import {useMemo} from "react"

import {useQuery} from "@tanstack/react-query"

import {fetchProjects} from "@/lib/context"

import {groupByOrganization, type OrganizationGroup} from "../context/workspaceGroups"

/** Projects grouped by organization, with the current group and project; one shared query. */
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
    // Match on the project: the route segment may be a workspace id or an organization id.
    const currentGroup =
        groups.find((group) =>
            group.projects.some((project) => project.project_id === projectId),
        ) ?? groups.find((group) => group.projects.some((p) => p.workspace_id === workspaceId))
    const currentProject = currentGroup?.projects.find(
        (project) => project.project_id === projectId,
    )
    return {query, groups, currentGroup, currentProject}
}
