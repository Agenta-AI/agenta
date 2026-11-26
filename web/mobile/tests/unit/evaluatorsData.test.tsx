// @vitest-environment jsdom
import {act, createElement} from "react"

import type {EvaluatorEntry} from "@agenta/entities/workflow"
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

interface ProbeProps {
    search?: string
    archived?: boolean
    category?: "automatic" | "human"
}
const ARGS = ({search = "", category = "automatic"}: ProbeProps) => ({
    projectId: "p1",
    category,
    search,
})

const Active = (props: ProbeProps) => {
    names = useEvaluators(ARGS(props)).entries.map((entry) => entry.workflow.name ?? "")
    return null
}
const Archived = (props: ProbeProps) => {
    names = useArchivedEvaluators(ARGS(props)).entries.map((entry) => entry.workflow.name ?? "")
    return null
}
const Probe = (props: ProbeProps) => {
    archive = useArchiveEvaluators("p1").archive
    return props.archived ? createElement(Archived, props) : createElement(Active, props)
}

const mount = async (props?: ProbeProps) => {
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

    it("Another tab's rows are not kept while the new tab loads", async () => {
        await mount()
        expect(names).toEqual(["Exact match check", "Length check"])
        api.queryWorkflows.mockImplementation(() => new Promise(noop))
        await act(async () => {
            root.render(
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(Probe, {category: "human"}),
                ),
            )
        })
        await flush()
        expect(names).toEqual([])
    })

    it("Archived evaluators ask the server to include archived workflows", async () => {
        await mount({archived: true})
        expect(api.queryWorkflows).toHaveBeenCalledWith(
            expect.objectContaining({includeArchived: true}),
        )
    })
})

describe("archiving evaluators", () => {
    const entry = (id: string) => {
        const server = makeEvaluatorServer()
        const workflow = server.workflows.find((item) => item.id === id)
        const latestRevision = latestByWorkflow(server.revisions).get(id)
        return {workflow, latestRevision} as unknown as EvaluatorEntry
    }
    const run = async (ids: string[], options = {checkInUse: true}) => {
        await mount()
        let outcome: ArchiveOutcome | undefined
        await act(async () => {
            outcome = await archive(ids.map(entry), options)
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
        await run(["w3"])
        expect(api.findRuns).not.toHaveBeenCalled()
        expect(api.archiveWorkflow).toHaveBeenCalledWith("p1", "w3")
    })

    it("A mixed selection checks only the automatic evaluators", async () => {
        await run(["w1", "w3"])
        expect(api.findRuns).toHaveBeenCalledWith({
            projectId: "p1",
            references: [{evaluator: {id: "w1"}}],
        })
        expect(api.archiveWorkflow).toHaveBeenCalledTimes(2)
    })

    it("Without the check the evaluators are archived without asking for runs", async () => {
        await run(["w1"], {checkInUse: false})
        expect(api.findRuns).not.toHaveBeenCalled()
        expect(api.archiveWorkflow).toHaveBeenCalledWith("p1", "w1")
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

    it("The list refreshes only after every archive request has finished", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(noop)
        let finishSecond: () => void = noop
        api.archiveWorkflow.mockImplementation((_project: string, id: string) =>
            id === "w1"
                ? Promise.reject(new Error("boom"))
                : new Promise<void>((resolve) => (finishSecond = resolve)),
        )
        await mount()
        let outcome: ArchiveOutcome | undefined
        let settled = false
        const pending = act(async () => {
            outcome = await archive([entry("w1"), entry("w2")], {checkInUse: false})
            settled = true
        })
        await flush()
        expect(settled).toBe(false)
        expect(api.invalidate).not.toHaveBeenCalled()
        finishSecond()
        await pending
        expect(outcome).toEqual({status: "failed"})
        expect(api.invalidate).toHaveBeenCalled()
        log.mockRestore()
    })
})
