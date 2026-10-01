import {getAccessClient} from "@agenta/sdk/resources"
import {useQuery} from "@tanstack/react-query"

export const fetchProjectPermission = async (
    projectId: string,
    action: string,
): Promise<boolean> => {
    try {
        await getAccessClient().checkPermissions(
            {
                action,
                scope_type: "project",
                scope_id: projectId,
                resource_type: "service",
            },
            // Match auth scope to scope_id; session auth otherwise selects the default project.
            {queryParams: {project_id: projectId}},
        )
        return true
    } catch (error) {
        // Only a 403 is an answer; anything else (offline, 5xx) leaves the permission unknown.
        if ((error as {statusCode?: number} | null)?.statusCode === 403) return false
        throw error
    }
}

const useProjectPermissionQuery = (projectId: string, action: string) =>
    useQuery({
        queryKey: ["mobile", "project-permission", projectId, action],
        queryFn: () => fetchProjectPermission(projectId, action),
        enabled: Boolean(projectId),
        staleTime: 30_000,
        retry: false,
    })

/** Read one effective project permission from the authenticated backend. */
export const useProjectPermission = (projectId: string, action: string): boolean =>
    useProjectPermissionQuery(projectId, action).data === true

/** The same permission, `undefined` until the backend has answered. */
export const useProjectPermissionState = (
    projectId: string,
    action: string,
): boolean | undefined => {
    const query = useProjectPermissionQuery(projectId, action)
    return query.isSuccess ? query.data : undefined
}
