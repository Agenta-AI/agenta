import {getAccessClient} from "@agenta/sdk/resources"
import {useQuery} from "@tanstack/react-query"

export const fetchProjectPermission = async (
    projectId: string,
    action: string,
): Promise<boolean> => {
    try {
        await getAccessClient().checkPermissions({
            action,
            scope_type: "project",
            scope_id: projectId,
            resource_type: "service",
        })
        return true
    } catch {
        return false
    }
}

/** Read one effective project permission from the authenticated backend. */
export const useProjectPermission = (projectId: string, action: string): boolean => {
    const query = useQuery({
        queryKey: ["mobile", "project-permission", projectId, action],
        queryFn: () => fetchProjectPermission(projectId, action),
        enabled: Boolean(projectId),
        staleTime: 30_000,
        retry: false,
    })

    return query.data === true
}
