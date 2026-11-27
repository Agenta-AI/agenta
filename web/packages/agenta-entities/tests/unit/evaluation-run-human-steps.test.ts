/**
 * The annotation form lists the human steps of a run; `annotationSteps` keeps every evaluator,
 * because `scenarioTraceRef` skips all of their results when it looks for the app trace.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai/vanilla"
import {expect, it, vi} from "vitest"

const {postMock} = vi.hoisted(() => ({postMock: vi.fn()}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    axios: {post: postMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {evaluationRunMolecule} from "../../src/evaluationRun"

const step = (key: string, type: string, origin: string | null) => ({
    key,
    type,
    origin,
    references: {evaluator: {id: `wf-${key}`}},
})

it("lists only the human annotation steps, and leaves annotationSteps whole", async () => {
    postMock.mockResolvedValue({
        data: {
            count: 1,
            runs: [
                {
                    id: "run-mixed",
                    status: "running",
                    data: {
                        steps: [
                            step("input", "input", "custom"),
                            step("app", "invocation", "auto"),
                            step("judge", "annotation", "auto"),
                            step("rules", "annotation", "custom"),
                            step("tone", "annotation", "human"),
                        ],
                    },
                },
            ],
        },
    })
    const store = getDefaultStore()
    store.set(projectIdAtom, "p1")

    const all = evaluationRunMolecule.selectors.annotationSteps("run-mixed")
    const human = evaluationRunMolecule.selectors.humanAnnotationSteps("run-mixed")
    const unsubscribe = store.sub(human, () => undefined)
    try {
        await vi.waitFor(() => expect(store.get(all)).toHaveLength(3))
    } finally {
        unsubscribe()
    }
    expect(store.get(all).map((item) => item.key)).toEqual(["judge", "rules", "tone"])
    expect(store.get(human).map((item) => item.key)).toEqual(["tone"])
})
