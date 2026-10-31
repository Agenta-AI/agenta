import {fetchProjectPermission, projectPermissionQueryKey} from "@agenta/entities/access"
import {useQuery} from "@tanstack/react-query"

/**
 * Read one effective project permission from the authenticated backend.
 *
 * It answers false while the check is in flight and false on an error, so a control gated on it
 * appears only once the backend has confirmed the reader may use it. The fetcher and the cache key
 * are the package's, so the atoms the `@agenta/*` surfaces gate on read the same answer.
 */
export const useProjectPermission = (projectId: string, action: string): boolean =>
    useProjectPermissionState(projectId, action).allowed

/**
 * The same check, with its waiting state.
 *
 * A screen that sends the reader somewhere else when the answer is "no" needs to tell "no" from
 * "not yet", or it would send everyone away while the first check is still in flight.
 */
export const useProjectPermissionState = (
    projectId: string,
    action: string,
): {allowed: boolean; pending: boolean} => {
    const query = useQuery({
        queryKey: projectPermissionQueryKey(projectId, action),
        queryFn: () => fetchProjectPermission(projectId, action),
        enabled: Boolean(projectId),
        staleTime: 30_000,
        retry: false,
    })

    return {allowed: query.data === true, pending: !projectId || query.isPending}
}
