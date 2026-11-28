import {describe, expect, it} from "vitest"

import {
    deriveEvaluationKind,
    humanizeRunStatus,
    isRunInProgress,
    isTerminalRunStatus,
    runDisplayStatus,
    runStatusTone,
} from "../../src/evaluationRun/core/runKind"
import {buildHumanRunConfig} from "../../src/evaluationRun/core/humanRunConfig"

const humanStep = {key: "ann", type: "annotation", origin: "human"}

describe("deriveEvaluationKind", () => {
    it("A live flag makes a run online even with human steps", () => {
        expect(deriveEvaluationKind({flags: {is_live: true}, data: {steps: [humanStep]}})).toBe(
            "online",
        )
        expect(deriveEvaluationKind({flags: {isLive: true}})).toBe("online")
        expect(deriveEvaluationKind({meta: {source: "online_evaluation_drawer"}})).toBe("online")
    })

    it("An annotation step with origin human makes a run human", () => {
        expect(deriveEvaluationKind({data: {steps: [humanStep]}})).toBe("human")
        expect(deriveEvaluationKind({data: {steps: [{type: "annotation", origin: "auto"}]}})).toBe(
            "auto",
        )
    })

    it("An automatic run that gets a human evaluator stays auto", () => {
        const steps = [
            {key: "testset", type: "input", origin: "auto"},
            {key: "app", type: "invocation", origin: "auto"},
            {key: "app.judge", type: "annotation", origin: "auto"},
            {key: "app.tone-review", type: "annotation", origin: "human"},
        ]
        expect(deriveEvaluationKind({data: {steps}})).toBe("auto")
    })

    it("A run built as a human run is human", () => {
        const {runs} = buildHumanRunConfig({
            name: "Review",
            testset: {id: "ts", name: "bench", revisionId: "tsr", columns: []},
            revision: {id: "rev"},
            inputKeys: [],
            hasMessagesInput: false,
            evaluators: [{revisionId: "evr", slug: "tone", outputKeys: []}],
        })
        expect(deriveEvaluationKind({data: {steps: runs[0].data.steps}})).toBe("human")
    })

    it("A run with no invocation step and a human step is human", () => {
        expect(
            deriveEvaluationKind({
                data: {steps: [{type: "input", origin: "auto"}, humanStep]},
            }),
        ).toBe("human")
    })

    it("An SDK run with custom app calls and a human evaluator is human", () => {
        const steps = [
            {key: "app", type: "invocation", origin: "custom"},
            {key: "app.review", type: "annotation", origin: "human"},
        ]
        expect(deriveEvaluationKind({data: {steps}})).toBe("human")
    })

    it("A step with origin custom makes a run custom", () => {
        expect(deriveEvaluationKind({data: {steps: [{type: "input", origin: "custom"}]}})).toBe(
            "custom",
        )
        expect(deriveEvaluationKind({data: {steps: [{metadata: {origin: "custom"}}]}})).toBe(
            "custom",
        )
    })

    it("A run with no special steps is auto", () => {
        expect(deriveEvaluationKind({data: {steps: [{type: "input", origin: "auto"}]}})).toBe(
            "auto",
        )
        expect(deriveEvaluationKind({})).toBe("auto")
        expect(deriveEvaluationKind(null)).toBe("auto")
    })
})

describe("run status rules", () => {
    it("Queued and running are not terminal; success, errors and cancelled are", () => {
        for (const status of ["queued", "running", "pending"]) {
            expect(isTerminalRunStatus(status)).toBe(false)
        }
        for (const status of ["success", "errors", "cancelled", "failure"]) {
            expect(isTerminalRunStatus(status)).toBe(true)
        }
        expect(isTerminalRunStatus(null)).toBe(false)
    })

    it("Status checks ignore case", () => {
        expect(isTerminalRunStatus("SUCCESS")).toBe(true)
        expect(isTerminalRunStatus("Evaluation_Finished")).toBe(true)
        expect(runStatusTone("RUNNING")).toBe("processing")
    })

    it("A queued auto run is in progress, a finished one is not", () => {
        expect(isRunInProgress({status: "queued"})).toBe(true)
        expect(isRunInProgress({status: "running", data: {steps: [{origin: "custom"}]}})).toBe(true)
        expect(isRunInProgress({status: "success"})).toBe(false)
        expect(isRunInProgress({status: null})).toBe(false)
    })

    it("Live and human runs never count as in progress", () => {
        expect(isRunInProgress({status: "running", flags: {is_live: true}})).toBe(false)
        expect(isRunInProgress({status: "running", data: {steps: [humanStep]}})).toBe(false)
    })

    it("Status tone maps errors to error and queued to processing", () => {
        expect(runStatusTone("errors")).toBe("error")
        expect(runStatusTone("queued")).toBe("processing")
        expect(runStatusTone("success")).toBe("success")
        expect(runStatusTone("cancelled")).toBe("default")
    })

    it("Status words are readable", () => {
        expect(humanizeRunStatus("errors")).toBe("Errors")
        expect(humanizeRunStatus("evaluation_finished")).toBe("Evaluation Finished")
    })
})

describe("runDisplayStatus", () => {
    const live = (flags: Record<string, boolean>, status = "running") => ({
        status,
        flags: {is_live: true, ...flags},
    })

    it("A live run that is not active and not closed reads Stopped", () => {
        expect(runDisplayStatus(live({is_active: false, is_closed: false}))).toBe("stopped")
        expect(humanizeRunStatus(runDisplayStatus(live({is_active: false})) ?? "")).toBe("Stopped")
        expect(runStatusTone("stopped")).toBe("default")
    })

    it("An active or closed live run keeps its own status", () => {
        expect(runDisplayStatus(live({is_active: true}))).toBe("running")
        expect(runDisplayStatus(live({is_active: false, is_closed: true}))).toBe("running")
        expect(runDisplayStatus(live({is_active: false}, "success"))).toBe("success")
    })

    it("A live run with no activity flag keeps its own status", () => {
        expect(runDisplayStatus({status: "running", flags: {is_live: true}})).toBe("running")
    })

    it("A run that is not live keeps its own status", () => {
        expect(runDisplayStatus({status: "running", flags: {is_active: false}})).toBe("running")
        expect(runDisplayStatus({status: null, flags: {is_live: true}})).toBeNull()
    })
})
