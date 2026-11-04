import {useProjectPermission} from "@/features/context/useProjectPermission"
import {useDeveloperViewEnabled} from "@/features/developer/developerViewAccess"

/** The one developer view behind every traces page action (add to test set, annotate). */
export const TRACE_ACTIONS_VIEW_ID = "observability-actions"

/**
 * Whether this user sees a traces page action: the developer view is on and the user has the
 * action's permission. The permission is asked only once the view is on, so the traces page
 * sends no extra request while the view is hidden.
 */
export const useTraceActionAccess = (
    projectId: string | null | undefined,
    permission: string,
): boolean => {
    const viewEnabled = useDeveloperViewEnabled(TRACE_ACTIONS_VIEW_ID) === true
    const allowed = useProjectPermission(viewEnabled ? (projectId ?? "") : "", permission)
    return viewEnabled && allowed
}
