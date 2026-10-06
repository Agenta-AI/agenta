import {fetchSingleOrg} from "@agenta/entities/organization"
import {fetchAllProjects} from "@agenta/entities/project"
import {useQuery} from "@tanstack/react-query"

/** The workspace's projects and the organization they belong to, shared through the query cache. */
export const useSettingsOrg = (workspaceId: string) => {
    const projects = useQuery({
        queryKey: ["projects", workspaceId],
        queryFn: () => fetchAllProjects(workspaceId),
    })
    const organizationId =
        projects.data?.find(
            (project) => project.organization_id && project.workspace_id === workspaceId,
        )?.organization_id ?? undefined
    const org = useQuery({
        queryKey: ["selectedOrg", organizationId],
        queryFn: () => fetchSingleOrg({organizationId: organizationId!}),
        enabled: Boolean(organizationId),
    })
    // A disabled query stays pending, so `org` only counts as loading once an id resolves.
    const loading = projects.isPending || (Boolean(organizationId) && org.isPending)
    // Failed only with nothing to show: a background refetch error keeps the loaded data.
    const failed =
        (projects.isError && !projects.data) ||
        (Boolean(projects.data) && !organizationId) ||
        (org.isError && !org.data)
    const retry = () => void (organizationId ? org.refetch() : projects.refetch())
    return {projects, organizationId, org, loading, failed, retry}
}
