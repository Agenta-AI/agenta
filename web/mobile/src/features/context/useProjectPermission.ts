import {checkProjectPermission, projectPermissionQueryKey} from "@agenta/entities/access"
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
 * "not yet", or it would send everyone away while the first check is still in flight. A lookup
 * that fails is reported as `failed`, not as a denial, and is never cached as one.
 */
export const useProjectPermissionState = (
    projectId: string,
    action: string,
): {allowed: boolean; pending: boolean; failed: boolean; recheck: () => void} => {
    const query = useQuery({
        queryKey: projectPermissionQueryKey(projectId, action),
        queryFn: () => checkProjectPermission(projectId, action),
        enabled: Boolean(projectId),
        staleTime: 30_000,
        retry: false,
    })

    return {
        allowed: query.data === true,
        pending: !projectId || query.isPending,
        // The lookup itself failed (not a refusal), so nothing is known. `recheck` runs it again.
        failed: query.isError,
        recheck: () => void query.refetch(),
    }
}
