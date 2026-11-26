import {
    workflowRevisionDrawerCallbackAtom,
    workflowRevisionDrawerIsolatedPlaygroundAtom,
    workflowRevisionDrawerOpenAtom,
} from "@agenta/playground-ui/workflow-revision-drawer"
import {createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

import {openEvaluatorDrawerAtom} from "@/oss/state/evaluator/evaluatorDrawerStore"

import {newEvaluationEvaluatorDrawerParams} from "./evaluatorDrawerParams"

describe("New Evaluation evaluator drawer", () => {
    it("opens in an isolated playground so closing it cannot delete the app's test cases", () => {
        const store = createStore()
        const onEvaluatorCreated = vi.fn()

        store.set(
            openEvaluatorDrawerAtom,
            newEvaluationEvaluatorDrawerParams("local-evaluator", onEvaluatorCreated),
        )

        expect(store.get(workflowRevisionDrawerOpenAtom)).toBe(true)
        expect(store.get(workflowRevisionDrawerIsolatedPlaygroundAtom)).toBe(true)
    })

    it("still hands the created evaluator to the modal", () => {
        const store = createStore()
        const onEvaluatorCreated = vi.fn()

        store.set(
            openEvaluatorDrawerAtom,
            newEvaluationEvaluatorDrawerParams("local-evaluator", onEvaluatorCreated),
        )
        store.get(workflowRevisionDrawerCallbackAtom)?.({configId: "rev-1"} as never)

        expect(onEvaluatorCreated).toHaveBeenCalledWith("rev-1")
    })
})
