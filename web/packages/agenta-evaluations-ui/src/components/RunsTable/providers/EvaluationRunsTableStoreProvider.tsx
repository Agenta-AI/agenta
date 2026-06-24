import type {PropsWithChildren} from "react"
import {useEffect, useMemo} from "react"

import type {PrimitiveAtom} from "jotai"
import {Provider, createStore, useStore} from "jotai"

import {
    injectedAppsQueryAtom,
    injectedRouterAppIdAtom,
    injectedUrlAtom,
    injectedAppIdentifiersAtom,
    injectedRouteLayerAtom,
    injectedQueriesQueryFamilyAtom,
    injectedCurrentWorkflowAtom,
    injectedMetricBlueprintFactoryAtom,
    injectedResolvedMetricLabelsFamilyAtom,
    injectedEvaluatorReferenceFamilyAtom,
    injectedWorkspaceMemberByIdFamilyAtom,
    injectedOnlineEvaluationsApiAtom,
} from "../../../host/runViewInjection"
import {
    type EvaluationRunsTableOverrides,
    defaultEvaluationRunsTableOverrides,
    evaluationRunsTableFetchEnabledAtom,
    evaluationRunsTableOverridesAtom,
} from "../atoms/context"
import {evaluationRunsRefreshTriggerAtom} from "../atoms/tableStore"
import {evaluationRunsTablePageSizeAtom} from "../atoms/view"

/* eslint-disable @typescript-eslint/no-explicit-any -- the mirrored-atoms helper writes
 * heterogeneous injected-atom values verbatim between two jotai stores; the value type per
 * atom is irrelevant to the mirror loop, which only needs a writable handle. */
type WritableAtom = PrimitiveAtom<any> & {write: any}

/**
 * Mirror a parent-store value into the scoped store. Several injected atoms hold a
 * FUNCTION value (the query/metric/member families, factories, the api object).
 * jotai's primitive `set` treats a function argument as a state UPDATER and would
 * call it (`queriesQueryFamily(prev)` with `prev = null` → crash in the family's
 * `{payload}` destructure), silently corrupting every function-valued atom. Wrap
 * function values in a constant updater so the function itself is stored; everything
 * else passes through verbatim. This mirrors how the host registers them
 * (`set(atom, () => v)`).
 */
const mirrorValue = (store: ReturnType<typeof createStore>, atom: WritableAtom, value: unknown) => {
    store.set(atom, typeof value === "function" ? () => value : value)
}

/**
 * Injected eval-view seams the relocated run-list tree reads. The OSS host registers their
 * real sources into the parent (default) store via `registerEvalRunInjections`; this
 * provider creates a SCOPED store and must mirror those values down so the relocated atoms
 * resolve the same data inside the scope. (Pre-relocation this list held the raw OSS global
 * atoms — `appStateSnapshotAtom` etc. — which are now consumed through these seams.)
 */
const MIRRORED_GLOBAL_ATOMS: WritableAtom[] = [
    injectedAppsQueryAtom as unknown as WritableAtom,
    injectedRouterAppIdAtom as unknown as WritableAtom,
    injectedUrlAtom as unknown as WritableAtom,
    injectedAppIdentifiersAtom as unknown as WritableAtom,
    injectedRouteLayerAtom as unknown as WritableAtom,
    injectedQueriesQueryFamilyAtom as unknown as WritableAtom,
    injectedCurrentWorkflowAtom as unknown as WritableAtom,
    injectedMetricBlueprintFactoryAtom as unknown as WritableAtom,
    injectedResolvedMetricLabelsFamilyAtom as unknown as WritableAtom,
    injectedEvaluatorReferenceFamilyAtom as unknown as WritableAtom,
    injectedWorkspaceMemberByIdFamilyAtom as unknown as WritableAtom,
    injectedOnlineEvaluationsApiAtom as unknown as WritableAtom,
    evaluationRunsRefreshTriggerAtom as WritableAtom,
]

interface EvaluationRunsTableStoreProviderProps extends PropsWithChildren {
    overrides: Partial<EvaluationRunsTableOverrides>
    pageSize: number
}

const EvaluationRunsTableStoreProvider = ({
    overrides,
    pageSize,
    children,
}: EvaluationRunsTableStoreProviderProps) => {
    const parentStore = useStore()
    const resolvedOverrides = useMemo(
        () => ({
            ...defaultEvaluationRunsTableOverrides,
            ...overrides,
        }),
        [overrides],
    )

    const scopedStore = useMemo(() => {
        const store = createStore()
        MIRRORED_GLOBAL_ATOMS.forEach((atom) => {
            mirrorValue(store, atom, parentStore.get(atom))
        })
        store.set(evaluationRunsTablePageSizeAtom, pageSize)
        store.set(evaluationRunsTableOverridesAtom, resolvedOverrides)
        store.set(evaluationRunsTableFetchEnabledAtom, true)
        return store
    }, [pageSize, parentStore, resolvedOverrides])

    useEffect(() => {
        const cleanups = MIRRORED_GLOBAL_ATOMS.map((atom) => {
            const sync = () => {
                mirrorValue(scopedStore, atom, parentStore.get(atom))
            }
            const unsub = parentStore.sub(atom, sync)
            sync()
            return unsub
        })
        return () => cleanups.forEach((unsub) => unsub())
    }, [parentStore, scopedStore])

    return <Provider store={scopedStore}>{children}</Provider>
}

export default EvaluationRunsTableStoreProvider
