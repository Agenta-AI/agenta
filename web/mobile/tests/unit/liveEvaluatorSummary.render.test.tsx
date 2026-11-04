// @vitest-environment jsdom
import {act, createElement} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {LiveEvaluatorSummary} from "@/features/evaluations/live/LiveEvaluatorSummary"

// The tag reads the template catalog for its label; this test checks the key it is given.
vi.mock("@agenta/entity-ui/workflow", () => ({
    WorkflowTypeTag: ({workflowKey}: {workflowKey?: string | null}) =>
        createElement("span", {"data-testid": "type-tag"}, workflowKey),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

const render = async (evaluator: Partial<Workflow>) => {
    await act(async () =>
        root.render(createElement(LiveEvaluatorSummary, {evaluator: evaluator as Workflow})),
    )
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("live evaluator summary", () => {
    it("The summary shows the evaluator type and its output metrics", async () => {
        await render({
            id: "rev-1",
            name: "Tone check",
            data: {
                uri: "agenta:builtin:auto_regex_test:v0",
                schemas: {
                    outputs: {
                        type: "object",
                        properties: {success: {type: "boolean"}, score: {type: "number"}},
                    },
                },
            },
        })

        expect(host.querySelector("[data-testid=type-tag]")?.textContent).toBe("auto_regex_test")
        expect(host.textContent).toContain("Output metrics")
        const metrics = [...host.querySelectorAll("li")].map((li) => li.textContent)
        expect(metrics).toEqual(["success", "score"])
    })

    it("An evaluator without outputs shows no metrics block", async () => {
        await render({
            id: "rev-1",
            name: "Tone check",
            data: {uri: "agenta:builtin:auto_regex_test:v0"},
        })

        expect(host.querySelector("[data-testid=type-tag]")?.textContent).toBe("auto_regex_test")
        expect(host.textContent).not.toContain("Output metrics")
    })
})
