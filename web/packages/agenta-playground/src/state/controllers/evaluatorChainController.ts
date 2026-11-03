/**
 * The evaluator playground's chain: an app before an evaluator, linked, so a run grades the
 * app's output. Kept apart from `playgroundController` so pages that never chain an evaluator
 * do not load it.
 */

import {atom, type Getter, type Setter} from "jotai"

import {playgroundNodesAtom} from "../atoms/playground"
import {cancelRunningResults} from "../execution"
import {derivedLoadableIdAtom} from "../execution/selectors"

import {playgroundController} from "./playgroundController"

/**
 * Stops every run in flight under the current loadable. A run keeps writing to the loadable and
 * the nodes it started with, so its results would stay "running" in the changed chain.
 */
function cancelRunsInFlight(get: Getter, set: Setter) {
    const loadableId = get(derivedLoadableIdAtom)
    if (loadableId) cancelRunningResults(get, set, loadableId)
}

/**
 * Runs an evaluator on an app's output: the app becomes the first node and the evaluator follows
 * it, linked. Picking another app replaces the first one.
 */
const connectAppToEvaluatorAtom = atom(
    null,
    (
        get,
        set,
        params: {
            appRevisionId: string
            appLabel: string
            evaluatorRevisionId: string
            evaluatorLabel: string
        },
    ) => {
        cancelRunsInFlight(get, set)
        const nodeId = set(playgroundController.actions.changePrimaryNode, {
            type: "workflow",
            id: params.appRevisionId,
            label: params.appLabel,
        })
        if (!nodeId) return
        set(playgroundController.actions.connectDownstreamNode, {
            sourceNodeId: nodeId,
            entity: {
                type: "workflow",
                id: params.evaluatorRevisionId,
                label: params.evaluatorLabel,
            },
        })
        // The test cases now feed the app: keys only the previous first node read go.
        set(playgroundController.actions.reconcileRowsToPrimary)
    },
)

/** Undoes `connectAppToEvaluator`: the evaluator is the only node again. */
const disconnectAppFromEvaluatorAtom = atom(null, (get, set) => {
    const evaluator = get(playgroundNodesAtom).find((node) => node.depth > 0)
    if (!evaluator) return
    cancelRunsInFlight(get, set)
    set(playgroundController.actions.removeNode, evaluator.id)
    set(playgroundController.actions.changePrimaryNode, {
        type: evaluator.entityType,
        id: evaluator.entityId,
        label: evaluator.label ?? evaluator.entityId,
    })
})

export const evaluatorChainController = {
    actions: {
        /** Put an app before an evaluator, linked (the evaluator playground's "Run on an app") */
        connectAppToEvaluator: connectAppToEvaluatorAtom,
        /** Remove the app before an evaluator */
        disconnectAppFromEvaluator: disconnectAppFromEvaluatorAtom,
    },
}
