import {useCallback, useEffect, useRef} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController, playgroundInitializedAtom} from "@agenta/playground"
import {clearPlayground} from "@agenta/playground-ui/state"
import {useAtomValue, useStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {useRouter} from "next/router"

import {parseRevisionIds} from "./playgroundUrl"
import type {PlaygroundLoadStatus} from "./usePlaygroundSelection"

export interface EvaluatorPlaygroundSelection {
    status: PlaygroundLoadStatus
    /** The evaluator revision on screen: first when alone, after the app when one is connected. */
    evaluatorRevisionId: string | null
    /** The first revision, which the test cases run on: the app when connected, else the evaluator. */
    primaryRevisionId: string | null
    /** The connected app revision, or null. */
    appRevisionId: string | null
    retry: () => void
}

/**
 * The evaluator playground's selection and lifecycle. On mount it opens the evaluator revision in
 * `?revisions=`. The address keeps naming the evaluator, also after a commit, and leaves the
 * connected app out: a reload opens the evaluator alone. On unmount the page's state goes.
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

    // The page opens the evaluator once. Later address changes come from this hook itself.
    useEffect(() => {
        const id = parseRevisionIds(routerRef.current.query.revisions)[0]
        if (!router.isReady || !id) return
        store.set(playgroundController.actions.addPrimaryNode, {type: "workflow", id, label: id})
        store.set(playgroundInitializedAtom, true)
        return () => clearPlayground(store, {keepEdits: true})
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
        retry,
    }
}
