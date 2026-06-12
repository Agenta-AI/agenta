import type {PropsWithChildren} from "react"
import {useEffect, useMemo} from "react"

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
} from "@agenta/evaluations/state"
import type {PrimitiveAtom} from "jotai"
import {Provider, createStore, useStore} from "jotai"

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
            store.set(atom, parentStore.get(atom))
        })
        store.set(evaluationRunsTablePageSizeAtom, pageSize)
        store.set(evaluationRunsTableOverridesAtom, resolvedOverrides)
        store.set(evaluationRunsTableFetchEnabledAtom, true)
        return store
    }, [pageSize, parentStore, resolvedOverrides])

    useEffect(() => {
        const cleanups = MIRRORED_GLOBAL_ATOMS.map((atom) => {
            const sync = () => {
                const value = parentStore.get(atom)
                scopedStore.set(atom, value)
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
