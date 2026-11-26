/**
 * The evaluator playground's chain: an app before an evaluator, linked, so a run grades the
 * app's output. Kept apart from `playgroundController` so pages that never chain an evaluator
 * do not load it.
 */

import {atom, type Getter, type Setter} from "jotai"

import {playgroundNodesAtom} from "../atoms/playground"
import {cancelRunningResults, resetExecutionAtom} from "../execution"
import {derivedLoadableIdAtom} from "../execution/selectors"
import type {EntitySelection} from "../types"

import {playgroundController, relinkLoadableSessions} from "./playgroundController"

/**
 * Makes `entity` the first node. The test cases, the test set connection and a chat conversation
 * live under the first node's loadable, so they move with it, as on a commit. The results belong
 * to the old first node and go. Runs in flight are stopped first: a run keeps writing to the
 * loadable and the nodes it started with, so its results would stay "running".
 */
function replaceFirstNode(get: Getter, set: Setter, entity: EntitySelection): string | null {
    const oldEntityId = get(playgroundNodesAtom)[0]?.entityId
    const oldLoadableId = get(derivedLoadableIdAtom)
    if (oldLoadableId) cancelRunningResults(get, set, oldLoadableId)
    const nodeId = set(playgroundController.actions.changePrimaryNode, entity)
    const newLoadableId = get(derivedLoadableIdAtom)
    if (oldEntityId && oldLoadableId && newLoadableId !== oldLoadableId) {
        relinkLoadableSessions(get, set, {
            oldEntityId,
            newEntityId: entity.id,
            oldLoadableId,
            newLoadableId,
        })
        set(resetExecutionAtom, {loadableId: newLoadableId})
    }
    return nodeId
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
        const nodeId = replaceFirstNode(get, set, {
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
    set(playgroundController.actions.removeNode, evaluator.id)
    replaceFirstNode(get, set, {
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
