import {describe, expect, it} from "vitest"

import {resolveWorkflowEntitySelection} from "./workflowEntitySelection"

const app = {id: "app-1", name: "App workflow"}
const otherApp = {id: "app-2", name: "Other app workflow"}
const evaluator = {id: "eval-1", name: "Evaluator workflow"}

describe("resolveWorkflowEntitySelection", () => {
    it("uses the workflow resolved from the current route first", () => {
        expect(
            resolveWorkflowEntitySelection({
                currentWorkflow: evaluator,
                currentWorkflowId: evaluator.id,
                apps: [app],
                evaluators: [evaluator],
                recentAppId: app.id,
                recentEvaluatorId: evaluator.id,
            }),
        ).toBe(evaluator)
    })

    it("resolves the current route workflow id before falling back to recents", () => {
        expect(
            resolveWorkflowEntitySelection({
                currentWorkflow: null,
                currentWorkflowId: evaluator.id,
                apps: [app],
                evaluators: [evaluator],
                recentAppId: app.id,
                recentEvaluatorId: null,
            }),
        ).toBe(evaluator)
    })

    it("prefers the recent app on project-level routes", () => {
        expect(
            resolveWorkflowEntitySelection({
                currentWorkflow: null,
                currentWorkflowId: null,
                apps: [app],
                evaluators: [evaluator],
                recentAppId: app.id,
                recentEvaluatorId: evaluator.id,
            }),
        ).toBe(app)
    })

    it("falls back to the recent evaluator when there is no recent app", () => {
        expect(
            resolveWorkflowEntitySelection({
                currentWorkflow: null,
                currentWorkflowId: null,
                apps: [otherApp],
                evaluators: [evaluator],
                recentAppId: null,
                recentEvaluatorId: evaluator.id,
            }),
        ).toBe(evaluator)
    })
})
