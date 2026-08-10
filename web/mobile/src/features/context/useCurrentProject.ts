import {useQuery} from "@tanstack/react-query"

import {fetchProjects, type MobileProject} from "@/lib/context"

/**
 * The route's project record.
 *
 * Reads the root picker's own query key and staleTime, so arriving here from the picker costs no
 * request and several callers on one screen collapse into one. Undefined while it resolves, and
 * for a project the current user cannot see — callers fall back rather than block on it.
 */
export const useCurrentProject = (
    workspaceId: string,
    projectId: string,
): MobileProject | undefined => {
    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })

    return query.data?.kind === "ok"
        ? query.data.projects.find(
              (project) => project.project_id === projectId && project.workspace_id === workspaceId,
          )
        : undefined
}
