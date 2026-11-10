import {useCallback, useEffect, useRef, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController, playgroundInitializedAtom} from "@agenta/playground"
import {clearPlayground} from "@agenta/playground-ui/state"
import {useAtomValue, useStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {useRouter} from "next/router"

import {
    hasPendingRestore,
    playgroundAddress,
    restoreSnapshot,
    snapshotTriggerAtom,
    syncSnapshotDrafts,
} from "./playgroundSnapshot"
import {parseRevisionIds, readSnapshotParam, SNAPSHOT_PARAM} from "./playgroundUrl"
import type {PlaygroundLoadStatus} from "./usePlaygroundSelection"

export interface EvaluatorPlaygroundSelection {
    status: PlaygroundLoadStatus
    /** The evaluator revision on screen: first when alone, after the app when one is connected. */
    evaluatorRevisionId: string | null
    /** The first revision, which the test cases run on: the app when connected, else the evaluator. */
    primaryRevisionId: string | null
    /** The connected app revision, or null. */
    appRevisionId: string | null
    /** A link brought back test cases with no app: they run on the evaluator directly. */
    restoredWithoutApp: boolean
    retry: () => void
}

/** How long the address waits after the last change before it is written. */
const ADDRESS_WRITE_DELAY_MS = 300

/**
 * The evaluator playground's selection and lifecycle. On mount it opens the evaluator revision in
 * `?revisions=`, with the connected app, the drafts and the test cases of the `#pgSnapshot` hash
 * when the address has one. The address keeps naming the evaluator, also after a commit, and the
 * hash follows the page, as in the app playground: a reload or a shared link opens the same
 * state. On unmount the page's state goes.
 */
export const useEvaluatorPlaygroundSelection = (): EvaluatorPlaygroundSelection => {
    const router = useRouter()
    const routerRef = useRef(router)
    routerRef.current = router
    const store = useStore()
    const requestedId = router.isReady ? (parseRevisionIds(router.query.revisions)[0] ?? "") : ""

    const nodes = useAtomValue(playgroundController.selectors.nodes())
    const evaluatorNode = nodes.find((node) => node.depth > 0) ?? nodes[0] ?? null
    const evaluatorId = evaluatorNode?.entityId ?? null
    const primaryId = nodes[0]?.entityId ?? null
    const query = useAtomValue(workflowMolecule.selectors.query(evaluatorId ?? requestedId))
    const isEvaluator = useAtomValue(
        workflowMolecule.selectors.isEvaluator(evaluatorId ?? requestedId),
    )

    // While a restored snapshot loads, the address is not written: it would drop the state.
    const restoringRef = useRef(false)
    const [restoredWithoutApp, setRestoredWithoutApp] = useState(false)

    // The page opens the evaluator once. Later address changes come from this hook itself.
    useEffect(() => {
        const id = parseRevisionIds(routerRef.current.query.revisions)[0]
        if (!router.isReady || !id) return
        let wanted = true
        const stopDrafts = syncSnapshotDrafts(store)
        const encoded = readSnapshotParam(window.location.hash)
        const restoring = encoded ? restoreSnapshot(store, encoded, () => wanted) : null
        if (restoring) {
            restoringRef.current = true
            void restoring.finally(() => {
                if (!wanted) return
                restoringRef.current = false
                setRestoredWithoutApp(
                    store.get(playgroundController.selectors.nodes()).length === 1,
                )
            })
        } else {
            store.set(playgroundController.actions.addPrimaryNode, {
                type: "workflow",
                id,
                label: id,
            })
        }
        store.set(playgroundInitializedAtom, true)
        return () => {
            wanted = false
            restoringRef.current = false
            stopDrafts()
            clearPlayground(store, {keepEdits: true})
        }
    }, [router.isReady, store])

    // Write the `#pgSnapshot` hash a moment after the last change, as the app playground does.
    // `?revisions=` keeps naming the evaluator (the effect below), not the app before it.
    useEffect(() => {
        if (!router.isReady) return
        const write = () => {
            if (restoringRef.current || hasPendingRestore(store)) return
            const {snapshot} = playgroundAddress(store)
            if (!snapshot || snapshot === readSnapshotParam(window.location.hash)) return
            const {pathname, query: current} = routerRef.current
            void routerRef.current
                .replace(
                    {pathname, query: current, hash: `${SNAPSHOT_PARAM}=${snapshot}`},
                    undefined,
                    {
                        shallow: true,
                        scroll: false,
                    },
                )
                .catch(() => undefined)
        }
        let timer: ReturnType<typeof setTimeout> | undefined
        const schedule = () => {
            clearTimeout(timer)
            timer = setTimeout(write, ADDRESS_WRITE_DELAY_MS)
        }
        const unsubscribe = store.sub(snapshotTriggerAtom, schedule)
        return () => {
            unsubscribe()
            clearTimeout(timer)
        }
    }, [router.isReady, store])

    // A commit of the evaluator swaps it for the new revision: the address follows.
    useEffect(() => {
        const {pathname, query: current} = routerRef.current
        if (!evaluatorId || evaluatorId === current.revisions) return
        void routerRef.current
            .replace({pathname, query: {...current, revisions: evaluatorId}}, undefined, {
                shallow: true,
            })
            .catch(() => undefined)
    }, [evaluatorId])

    const retry = useCallback(() => {
        const queryClient = store.get(queryClientAtom)
        void queryClient.refetchQueries({queryKey: ["workflows", "revision", evaluatorId]})
    }, [evaluatorId, store])

    const status = ((): PlaygroundLoadStatus => {
        if (router.isReady && !requestedId) return "not-found"
        if (query.isError) return "error"
        if (!evaluatorId || query.isPending) return "loading"
        return query.data && isEvaluator ? "ready" : "not-found"
    })()

    return {
        status,
        evaluatorRevisionId: evaluatorId,
        primaryRevisionId: primaryId,
        appRevisionId: nodes.length > 1 ? primaryId : null,
        restoredWithoutApp,
        retry,
    }
}
