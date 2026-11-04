import {useProjectPermission} from "@/features/context/useProjectPermission"
import {useDeveloperViewEnabled} from "@/features/developer/developerViewAccess"

export const ADD_TO_TESTSET_VIEW_ID = "observability-add-to-testset"

/**
 * Whether this user sees the add-to-test-set entry points: the developer view is on and the
 * user may edit test sets. The permission is asked only once the view is on, so the traces page
 * sends no extra request while the view is hidden.
 */
export const useAddToTestsetAccess = (projectId: string | null | undefined): boolean => {
    const viewEnabled = useDeveloperViewEnabled(ADD_TO_TESTSET_VIEW_ID) === true
    const canEdit = useProjectPermission(viewEnabled ? (projectId ?? "") : "", "edit_testsets")
    return viewEnabled && canEdit
}
