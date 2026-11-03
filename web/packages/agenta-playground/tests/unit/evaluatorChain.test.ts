/**
 * The evaluator chain on the real controllers: an app connected upstream of an evaluator, the
 * actions that build and undo that chain, and what happens to runs in flight when the chain or
 * its first revision changes.
 *
 * Each test uses a fresh store and its own ids: the loadable anchor in `derivedLoadableIdAtom` is
 * module-level state.
 */

import {loadableController} from "@agenta/entities/loadable"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {outputConnectionsAtom} from "../../src/state/atoms/connections"
import {evaluatorChainController} from "../../src/state/controllers/evaluatorChainController"
import {playgroundController} from "../../src/state/controllers/playgroundController"
import {cancelTestsMutationAtom} from "../../src/state/execution"
import {resultsByKeyAtomFamily, startRunAtom} from "../../src/state/execution"
import {registerAbortController} from "../../src/state/execution/atoms"

type Store = ReturnType<typeof createStore>

const nodesOf = (store: Store) =>
    store
        .get(playgroundController.selectors.nodes())
        .map(({entityId, label, depth}) => ({entityId, label, depth}))

/** The connections, as entity ids instead of node ids. */
const edgesOf = (store: Store) => {
    const nodes = store.get(playgroundController.selectors.nodes())
    const entityOf = (nodeId: string) => nodes.find((node) => node.id === nodeId)?.entityId
    return store
        .get(outputConnectionsAtom)
        .map((connection) => [entityOf(connection.sourceNodeId), entityOf(connection.targetNodeId)])
}

/** An evaluator alone, as the evaluator playground opens it. */
const openEvaluator = (store: Store, evaluatorId: string) => {
    store.set(playgroundController.actions.addPrimaryNode, {
        type: "workflow",
        id: evaluatorId,
        label: "Exact match",
    })
}

const connect = (store: Store, appId: string, evaluatorId: string) =>
    store.set(evaluatorChainController.actions.connectAppToEvaluator, {
        appRevisionId: appId,
        appLabel: "Support bot",
        evaluatorRevisionId: evaluatorId,
        evaluatorLabel: "Exact match",
    })

/** A run in flight for the app and its evaluator, with a live abort controller. */
const startChainRun = (store: Store, appId: string, evaluatorId: string, runId: string) => {
    const loadableId = store.get(playgroundController.selectors.loadableId())
    const controller = new AbortController()
    registerAbortController(runId, controller)
    for (const sessionId of [`sess:${appId}`, `sess:${appId}:${evaluatorId}`]) {
        store.set(startRunAtom, {loadableId, stepId: "row-1", sessionId, runId})
    }
    return {loadableId, controller}
}

const statusesIn = (store: Store, loadableId: string) =>
    Object.fromEntries(
        Object.entries(store.get(resultsByKeyAtomFamily(loadableId))).map(([key, result]) => [
            key,
            result.status,
        ]),
    )

describe("connectAppToEvaluator", () => {
    it("puts the app first and the evaluator after it, linked", () => {
        const store = createStore()
        openEvaluator(store, "eval-a1")

        connect(store, "app-a1", "eval-a1")

        expect(nodesOf(store)).toEqual([
            {entityId: "app-a1", label: "Support bot", depth: 0},
            {entityId: "eval-a1", label: "Exact match", depth: 1},
        ])
        expect(edgesOf(store)).toEqual([["app-a1", "eval-a1"]])
        expect(store.get(playgroundController.selectors.entityIds())).toEqual(["app-a1"])
        expect(store.get(playgroundController.selectors.loadableId())).toBe(
            "testset:workflow:app-a1",
        )
    })

    it("replaces the app when another one is picked, and keeps one link", () => {
        const store = createStore()
        openEvaluator(store, "eval-b1")
        connect(store, "app-b1", "eval-b1")

        connect(store, "app-b2", "eval-b1")

        expect(nodesOf(store)).toEqual([
            {entityId: "app-b2", label: "Support bot", depth: 0},
            {entityId: "eval-b1", label: "Exact match", depth: 1},
        ])
        expect(edgesOf(store)).toEqual([["app-b2", "eval-b1"]])
    })

    it("stops a run in flight before the chain changes", () => {
        const store = createStore()
        openEvaluator(store, "eval-c1")
        connect(store, "app-c1", "eval-c1")
        const {loadableId, controller} = startChainRun(store, "app-c1", "eval-c1", "run-c1")

        connect(store, "app-c2", "eval-c1")

        expect(controller.signal.aborted).toBe(true)
        expect(statusesIn(store, loadableId)).toEqual({
            "row-1:sess:app-c1": "cancelled",
            "row-1:sess:app-c1:eval-c1": "cancelled",
        })
    })
})

describe("a connected test set when the app changes", () => {
    const connectTestset = (store: Store) =>
        store.set(playgroundController.actions.connectToTestset, {
            loadableId: store.get(playgroundController.selectors.loadableId()),
            revisionId: "testset-revision-1",
            testcases: [{id: "testcase-1", country: "Spain"}],
            testsetName: "Capitals",
            testsetId: "testset-1",
            revisionVersion: 2,
        })
    const sourceOf = (store: Store) =>
        store.get(
            loadableController.selectors.connectedSource(
                store.get(playgroundController.selectors.loadableId()),
            ),
        )

    it("stays connected when another app is picked, and when the app is disconnected", () => {
        const store = createStore()
        openEvaluator(store, "eval-k1")
        connect(store, "app-k1", "eval-k1")
        connectTestset(store)

        connect(store, "app-k2", "eval-k1")

        expect(store.get(playgroundController.selectors.loadableId())).toBe(
            "testset:workflow:app-k2",
        )
        expect(sourceOf(store)?.id).toBe("testset-revision-1")
        expect(
            store.get(
                loadableController.selectors.displayRowIds(
                    store.get(playgroundController.selectors.loadableId()),
                ),
            ),
        ).toEqual(["testcase-1"])

        store.set(evaluatorChainController.actions.disconnectAppFromEvaluator)

        expect(store.get(playgroundController.selectors.loadableId())).toBe(
            "testset:workflow:eval-k1",
        )
        expect(sourceOf(store)?.id).toBe("testset-revision-1")
    })
})

describe("disconnectAppFromEvaluator", () => {
    it("leaves the evaluator alone, with no link", () => {
        const store = createStore()
        openEvaluator(store, "eval-d1")
        connect(store, "app-d1", "eval-d1")

        store.set(evaluatorChainController.actions.disconnectAppFromEvaluator)

        expect(nodesOf(store)).toEqual([{entityId: "eval-d1", label: "Exact match", depth: 0}])
        expect(edgesOf(store)).toEqual([])
        expect(store.get(playgroundController.selectors.entityIds())).toEqual(["eval-d1"])
        expect(store.get(playgroundController.selectors.loadableId())).toBe(
            "testset:workflow:eval-d1",
        )
    })

    it("does nothing when no app is connected", () => {
        const store = createStore()
        openEvaluator(store, "eval-e1")

        store.set(evaluatorChainController.actions.disconnectAppFromEvaluator)

        expect(nodesOf(store)).toEqual([{entityId: "eval-e1", label: "Exact match", depth: 0}])
    })

    it("stops a run in flight", () => {
        const store = createStore()
        openEvaluator(store, "eval-f1")
        connect(store, "app-f1", "eval-f1")
        const {loadableId, controller} = startChainRun(store, "app-f1", "eval-f1", "run-f1")

        store.set(evaluatorChainController.actions.disconnectAppFromEvaluator)

        expect(controller.signal.aborted).toBe(true)
        expect(Object.values(statusesIn(store, loadableId))).toEqual(["cancelled", "cancelled"])
    })
})

describe("switchEntity on a chained evaluator", () => {
    it("swaps the evaluator in place and keeps the app first (a commit of the evaluator)", () => {
        const store = createStore()
        openEvaluator(store, "eval-g1")
        connect(store, "app-g1", "eval-g1")

        store.set(playgroundController.actions.switchEntity, {
            currentEntityId: "eval-g1",
            newEntityId: "eval-g2",
        })

        expect(nodesOf(store)).toEqual([
            {entityId: "app-g1", label: "Support bot", depth: 0},
            {entityId: "eval-g2", label: "Exact match", depth: 1},
        ])
        expect(edgesOf(store)).toEqual([["app-g1", "eval-g2"]])
        expect(store.get(playgroundController.selectors.entityIds())).toEqual(["app-g1"])
    })
})

describe("runs in flight when the chain's first revision moves (F-O1)", () => {
    it("a commit of the app cancels the app and evaluator results, in the old and new place", () => {
        const store = createStore()
        openEvaluator(store, "eval-h1")
        connect(store, "app-h1", "eval-h1")
        const {loadableId, controller} = startChainRun(store, "app-h1", "eval-h1", "run-h1")

        store.set(playgroundController.actions.switchEntity, {
            currentEntityId: "app-h1",
            newEntityId: "app-h2",
        })

        expect(controller.signal.aborted).toBe(true)
        const newLoadableId = store.get(playgroundController.selectors.loadableId())
        expect(newLoadableId).toBe("testset:workflow:app-h2")
        const running = [
            ...Object.values(statusesIn(store, loadableId)),
            ...Object.values(statusesIn(store, newLoadableId)),
        ].filter((status) => status === "running" || status === "pending")
        expect(running).toEqual([])
    })

    it("Cancel on a row also stops the evaluator results of that run", async () => {
        const store = createStore()
        openEvaluator(store, "eval-i1")
        connect(store, "app-i1", "eval-i1")
        const {loadableId, controller} = startChainRun(store, "app-i1", "eval-i1", "run-i1")

        await store.set(cancelTestsMutationAtom, {rowId: "row-1", entityId: "app-i1"})

        expect(controller.signal.aborted).toBe(true)
        expect(statusesIn(store, loadableId)).toEqual({
            "row-1:sess:app-i1": "cancelled",
            "row-1:sess:app-i1:eval-i1": "cancelled",
        })
    })

    it("a run of another row keeps going when one row is cancelled", async () => {
        const store = createStore()
        openEvaluator(store, "eval-j1")
        connect(store, "app-j1", "eval-j1")
        const loadableId = store.get(playgroundController.selectors.loadableId())
        store.set(startRunAtom, {
            loadableId,
            stepId: "row-1",
            sessionId: "sess:app-j1",
            runId: "run-j1",
        })
        store.set(startRunAtom, {
            loadableId,
            stepId: "row-2",
            sessionId: "sess:app-j1",
            runId: "run-j2",
        })

        await store.set(cancelTestsMutationAtom, {rowId: "row-1", entityId: "app-j1"})

        expect(statusesIn(store, loadableId)).toEqual({
            "row-1:sess:app-j1": "cancelled",
            "row-2:sess:app-j1": "running",
        })
    })
})
