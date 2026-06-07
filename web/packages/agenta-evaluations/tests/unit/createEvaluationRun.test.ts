import {describe, expect, it} from "vitest"

import {
    buildScenarioStepResults,
    createEvaluationRun,
    EvaluationRunCreationError,
    type EvaluationsCreateClient,
} from "../../src/controllers/createEvaluationRun"

// NOTE (T4): every test injects a FAKE client — no @agenta/sdk, no @agentaai/api-client,
// no backend. That is what makes the orchestration + rollback branches deterministically
// testable in plain Node, the headless-controller property the migration requires.

interface Calls {
    createRuns: number
    createScenarios: number
    setResults: number
    deleteRuns: number
    lastResults?: unknown[]
    lastDeleteRunIds?: string[]
}

interface FakeOptions {
    runsResult?: {runs?: {id?: string | null}[]}
    scenariosResult?: {scenarios?: {id?: string | null}[]}
    failOn?: "createRuns" | "createScenarios" | "setResults"
    failDelete?: boolean
}

function makeFakeClient(opts: FakeOptions = {}): {client: EvaluationsCreateClient; calls: Calls} {
    const calls: Calls = {createRuns: 0, createScenarios: 0, setResults: 0, deleteRuns: 0}
    const client: EvaluationsCreateClient = {
        async createRuns() {
            calls.createRuns++
            if (opts.failOn === "createRuns") throw new Error("createRuns boom")
            return (opts.runsResult ?? {runs: [{id: "run-1"}]}) as any
        },
        async createScenarios() {
            calls.createScenarios++
            if (opts.failOn === "createScenarios") throw new Error("createScenarios boom")
            return (opts.scenariosResult ?? {
                scenarios: [{id: "scn-1"}, {id: "scn-2"}],
            }) as any
        },
        async setResults(results) {
            calls.setResults++
            calls.lastResults = results
            if (opts.failOn === "setResults") throw new Error("setResults boom")
            return {} as any
        },
        async deleteRuns(runIds) {
            calls.deleteRuns++
            calls.lastDeleteRunIds = runIds
            if (opts.failDelete) throw new Error("deleteRuns boom")
            return {count: runIds.length, run_ids: runIds} as any
        },
    }
    return {client, calls}
}

const steps = [
    {key: "ts-1", type: "input" as const, origin: "auto" as const, references: {}},
    {key: "inv-1", type: "invocation" as const, origin: "human" as const, references: {}},
    {key: "inv-1.exact", type: "annotation" as const, origin: "human" as const, references: {}},
]

const baseArgs = {
    projectId: "proj-1",
    runs: [{name: "Run 1", data: {steps}}] as any,
    testcaseIds: ["tc-1", "tc-2"],
}

describe("createEvaluationRun (orchestration + rollback)", () => {
    it("happy path: creates run, scenarios, results and returns created", async () => {
        const {client, calls} = makeFakeClient()
        const result = await createEvaluationRun(baseArgs, client)

        expect(result.status).toBe("created")
        expect(result.runId).toBe("run-1")
        expect(result.scenarioIds).toEqual(["scn-1", "scn-2"])
        expect(calls).toMatchObject({
            createRuns: 1,
            createScenarios: 1,
            setResults: 1,
            deleteRuns: 0,
        })
    })

    it("builds one result row per scenario × step, input step marked success, testcase tagged", async () => {
        const {client, calls} = makeFakeClient()
        await createEvaluationRun(baseArgs, client)

        // 2 scenarios × 3 steps = 6 rows
        expect(calls.lastResults).toHaveLength(6)
        const rows = calls.lastResults as Record<string, unknown>[]
        // scenario 1 input row
        expect(rows[0]).toEqual({
            run_id: "run-1",
            scenario_id: "scn-1",
            step_key: "ts-1",
            testcase_id: "tc-1",
            status: "success",
        })
        // invocation/annotation rows have no status
        expect(rows[1]).toEqual({
            run_id: "run-1",
            scenario_id: "scn-1",
            step_key: "inv-1",
            testcase_id: "tc-1",
        })
        // scenario 2 maps to tc-2
        expect(rows[3].testcase_id).toBe("tc-2")
        expect(rows[3].scenario_id).toBe("scn-2")
    })

    it("createRuns failure: throws, no rollback (nothing created yet)", async () => {
        const {client, calls} = makeFakeClient({failOn: "createRuns"})
        await expect(createEvaluationRun(baseArgs, client)).rejects.toMatchObject({
            name: "EvaluationRunCreationError",
            stage: "createRuns",
            rolledBack: false,
            runId: undefined,
        })
        expect(calls.deleteRuns).toBe(0)
    })

    it("createRuns returns no id: throws createRuns stage, no rollback", async () => {
        const {client, calls} = makeFakeClient({runsResult: {runs: [{id: null}]}})
        await expect(createEvaluationRun(baseArgs, client)).rejects.toMatchObject({
            stage: "createRuns",
            rolledBack: false,
        })
        expect(calls.createScenarios).toBe(0)
        expect(calls.deleteRuns).toBe(0)
    })

    it("createScenarios failure: rolls back the created run", async () => {
        const {client, calls} = makeFakeClient({failOn: "createScenarios"})
        await expect(createEvaluationRun(baseArgs, client)).rejects.toMatchObject({
            stage: "createScenarios",
            runId: "run-1",
            rolledBack: true,
        })
        expect(calls.deleteRuns).toBe(1)
        expect(calls.lastDeleteRunIds).toEqual(["run-1"])
        expect(calls.setResults).toBe(0)
    })

    it("setResults failure: rolls back the created run", async () => {
        const {client, calls} = makeFakeClient({failOn: "setResults"})
        await expect(createEvaluationRun(baseArgs, client)).rejects.toMatchObject({
            stage: "setResults",
            runId: "run-1",
            rolledBack: true,
        })
        expect(calls.deleteRuns).toBe(1)
    })

    it("rollback failure: surfaces rolledBack=false (no silent loss)", async () => {
        const {client, calls} = makeFakeClient({failOn: "createScenarios", failDelete: true})
        await expect(createEvaluationRun(baseArgs, client)).rejects.toMatchObject({
            stage: "createScenarios",
            runId: "run-1",
            rolledBack: false,
        })
        expect(calls.deleteRuns).toBe(1)
    })

    it("empty testcaseIds: creates run, no scenarios, skips setResults", async () => {
        const {client, calls} = makeFakeClient({scenariosResult: {scenarios: []}})
        const result = await createEvaluationRun({...baseArgs, testcaseIds: []}, client)
        expect(result.status).toBe("created")
        expect(result.scenarioIds).toEqual([])
        expect(calls.setResults).toBe(0)
    })

    it("is an EvaluationRunCreationError with a cause chain", async () => {
        const {client} = makeFakeClient({failOn: "createScenarios"})
        const err = await createEvaluationRun(baseArgs, client).catch((e) => e)
        expect(err).toBeInstanceOf(EvaluationRunCreationError)
        expect((err as EvaluationRunCreationError).cause).toBeInstanceOf(Error)
    })
})

describe("buildScenarioStepResults (pure)", () => {
    it("returns empty when no scenarios", () => {
        expect(
            buildScenarioStepResults({runId: "r", scenarioIds: [], testcaseIds: [], steps}),
        ).toEqual([])
    })

    it("omits testcase_id when absent for a scenario index", () => {
        const rows = buildScenarioStepResults({
            runId: "r",
            scenarioIds: ["s1"],
            testcaseIds: [],
            steps: [steps[0]],
        })
        expect(rows[0]).toEqual({
            run_id: "r",
            scenario_id: "s1",
            step_key: "ts-1",
            status: "success",
        })
        expect("testcase_id" in rows[0]).toBe(false)
    })
})
