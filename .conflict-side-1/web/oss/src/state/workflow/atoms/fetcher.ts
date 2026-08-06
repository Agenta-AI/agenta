import {
    appWorkflowsListQueryAtom,
    evaluatorsListQueryAtom,
    type Workflow,
} from "@agenta/entities/workflow"
import {stringStorage} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

const LS_EVALUATOR_KEY = "recentlyVisitedEvaluator"

/**
 * Recent evaluator workflow ID, persisted in localStorage.
 * Parallel to `recentAppIdAtom` (apps) — the two are independent and never
 * cross-write. The `/evaluators` listing page may use this for fallback when
 * URL has no ID. No v1 read site exists yet; pre-write only.
 */
export const recentEvaluatorIdAtom = atomWithStorage<string | null>(
    LS_EVALUATOR_KEY,
    null,
    stringStorage,
)

/**
 * Combined map of all workflows (apps + evaluators) keyed by ID, plus loading state.
 *
 * Sources from BOTH `appWorkflowsListQueryAtom` and `evaluatorsListQueryAtom`. Each
 * underlying query filters server-side by role flag; the map is the union.
 *
 * **Contract:** never read `.data.get(id)` for ID resolution unless you've also
 * gated on `!isLoading`, or read via `currentWorkflowContextAtom` which handles
 * loading state. The aggregate `isLoading` flag is the canonical "settled" check;
 * per-source flags are exposed for diagnosis.
 *
 * `isLoading` here uses TanStack v5 `isPending` semantics — initial-load only,
 * not background refetch. If a consumer needs "any in-flight" status, read
 * `isFetching` from the underlying query atoms.
 */
export interface WorkflowsByIdMap {
    data: Map<string, Workflow>
    appsLoading: boolean
    evalsLoading: boolean
    isLoading: boolean
    isError: boolean
}

const EmptyMap = new Map<string, Workflow>()

export const workflowsByIdMapAtom = atom<WorkflowsByIdMap>((get) => {
    const apps = get(appWorkflowsListQueryAtom)
    const evals = get(evaluatorsListQueryAtom)

    const appsLoading = apps.isPending ?? false
    const evalsLoading = evals.isPending ?? false
    const isLoading = appsLoading || evalsLoading
    const isError = (apps.isError ?? false) || (evals.isError ?? false)

    if (isLoading) {
        return {
            data: EmptyMap,
            appsLoading,
            evalsLoading,
            isLoading,
            isError,
        }
    }

    const map = new Map<string, Workflow>()
    const appRefs = (apps.data?.refs ?? []) as Workflow[]
    const evalRefs = (evals.data?.refs ?? []) as Workflow[]
    for (const w of appRefs) map.set(w.id, w)
    for (const w of evalRefs) map.set(w.id, w)

    return {
        data: map,
        appsLoading,
        evalsLoading,
        isLoading,
        isError,
    }
})
