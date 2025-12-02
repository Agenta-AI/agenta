import type {PropsWithChildren} from "react"
import {useEffect, useMemo} from "react"

import {useQueryClient} from "@tanstack/react-query"
import type {PrimitiveAtom} from "jotai"
import {Provider, createStore, useStore} from "jotai"

import {recentAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {appStateSnapshotAtom} from "@/oss/state/appState"
import {sessionExistsAtom} from "@/oss/state/session"
import {activeInviteAtom} from "@/oss/state/url/auth"

import {
    type EvaluationRunsTableOverrides,
    defaultEvaluationRunsTableOverrides,
    evaluationRunsTableFetchEnabledAtom,
    evaluationRunsTableOverridesAtom,
} from "../atoms/context"
import {evaluationRunsRefreshTriggerAtom} from "../atoms/tableStore"
import {evaluationRunsTablePageSizeAtom} from "../atoms/view"

type WritableAtom = PrimitiveAtom<any> & {write: any}

const MIRRORED_GLOBAL_ATOMS: WritableAtom[] = [
    appStateSnapshotAtom as WritableAtom,
    sessionExistsAtom as WritableAtom,
    activeInviteAtom as WritableAtom,
    recentAppIdAtom as WritableAtom,
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
    const queryClient = useQueryClient()
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
    }, [pageSize, parentStore, queryClient, resolvedOverrides])

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
