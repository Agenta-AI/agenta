// @vitest-environment jsdom
import {act, createElement} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const noop = vi.hoisted(() => () => undefined)
const api = vi.hoisted(() => ({
    queryWorkflows: vi.fn(),
    fetchWorkflowsBatch: vi.fn(),
    archiveWorkflow: vi.fn(),
    invalidate: vi.fn(),
    findRuns: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))
vi.mock("@agenta/entities/workflow", async (original) => ({
    ...(await original<object>()),
    queryWorkflows: (...args: unknown[]) => api.queryWorkflows(...args),
    fetchWorkflowsBatch: (...args: unknown[]) => api.fetchWorkflowsBatch(...args),
    archiveWorkflow: (...args: unknown[]) => api.archiveWorkflow(...args),
    invalidateEvaluatorsListCache: () => api.invalidate(),
}))
vi.mock("@agenta/entities/evaluationRun", () => ({
    findEvaluationRunsUsing: (...args: unknown[]) => api.findRuns(...args),
}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: api.success, error: api.error}}))

import {useArchivedEvaluators} from "@/features/evaluators/useArchivedEvaluators"
import {useArchiveEvaluators, type ArchiveOutcome} from "@/features/evaluators/useArchiveEvaluators"
import {useEvaluators} from "@/features/evaluators/useEvaluators"

import {latestByWorkflow, makeEvaluatorServer} from "./evaluatorsFixtures"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
let client: QueryClient
let archive: ReturnType<typeof useArchiveEvaluators>["archive"]
let names: string[] = []

const flush = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

const ARGS = (search: string) => ({projectId: "p1", category: "automatic" as const, search})

const Active = ({search}: {search: string}) => {
    names = useEvaluators(ARGS(search)).entries.map((entry) => entry.workflow.name ?? "")
    return null
}
const Archived = ({search}: {search: string}) => {
    names = useArchivedEvaluators(ARGS(search)).entries.map((entry) => entry.workflow.name ?? "")
    return null
}
const Probe = ({search = "", archived = false}: {search?: string; archived?: boolean}) => {
    archive = useArchiveEvaluators("p1").archive
    return archived ? createElement(Archived, {search}) : createElement(Active, {search})
}

const mount = async (props?: {search?: string; archived?: boolean}) => {
    await act(async () => {
        root.render(createElement(QueryClientProvider, {client}, createElement(Probe, props)))
    })
    await flush()
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    Object.values(api).forEach((mock) => mock.mockReset())
    const server = makeEvaluatorServer()
    api.queryWorkflows.mockResolvedValue({workflows: server.workflows})
    api.fetchWorkflowsBatch.mockResolvedValue(latestByWorkflow(server.revisions))
    api.archiveWorkflow.mockResolvedValue({count: 1})
    api.findRuns.mockResolvedValue([])
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("evaluator lists", () => {
    it("The search term is sent as the name filter", async () => {
        await mount({search: "exact"})
        expect(api.queryWorkflows).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: "p1",
                name: "exact",
                flags: {is_evaluator: true},
                includeArchived: false,
            }),
        )
    })

    it("The live list holds the automatic evaluators only", async () => {
        await mount()
        expect(names).toEqual(["Exact match check", "Length check"])
    })

    it("Archived evaluators ask the server to include archived workflows", async () => {
        await mount({archived: true})
        expect(api.queryWorkflows).toHaveBeenCalledWith(
            expect.objectContaining({includeArchived: true}),
        )
    })
})

describe("archiving evaluators", () => {
    const run = async (ids: string[], category: "automatic" | "human" = "automatic") => {
        await mount()
        let outcome: ArchiveOutcome | undefined
        await act(async () => {
            outcome = await archive(ids, category)
        })
        return outcome
    }

    it("Archiving an evaluator in use archives nothing", async () => {
        api.findRuns.mockResolvedValue(["run-1", "run-2"])
        expect(await run(["w1"])).toEqual({status: "in-use", runCount: 2})
        expect(api.findRuns).toHaveBeenCalledWith({
            projectId: "p1",
            references: [{evaluator: {id: "w1"}}],
        })
        expect(api.archiveWorkflow).not.toHaveBeenCalled()
        expect(api.success).not.toHaveBeenCalled()
    })

    it("Archiving two evaluators shows 2 evaluators archived", async () => {
        expect(await run(["w1", "w2"])).toEqual({status: "archived"})
        expect(api.archiveWorkflow).toHaveBeenCalledTimes(2)
        expect(api.success).toHaveBeenCalledWith("2 evaluators archived")
        expect(api.invalidate).toHaveBeenCalled()
    })

    it("Archiving one evaluator shows Evaluator archived", async () => {
        await run(["w1"])
        expect(api.success).toHaveBeenCalledWith("Evaluator archived")
    })

    it("A human evaluator skips the in-use check", async () => {
        await run(["w3"], "human")
        expect(api.findRuns).not.toHaveBeenCalled()
        expect(api.archiveWorkflow).toHaveBeenCalledWith("p1", "w3")
    })

    it("A failed archive shows Failed to archive evaluators", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(noop)
        api.archiveWorkflow.mockRejectedValue(new Error("403 raw api text"))
        expect(await run(["w1"])).toEqual({status: "failed"})
        expect(api.error).toHaveBeenCalledWith("Failed to archive evaluators")
        expect(JSON.stringify(api.error.mock.calls)).not.toContain("raw api text")
        expect(api.success).not.toHaveBeenCalled()
        log.mockRestore()
    })
})
