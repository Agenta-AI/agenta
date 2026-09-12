import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const fetchWorkflowAgentFlags = vi.fn()
const queryWorkflows = vi.fn()

vi.mock("../../src/workflow/api/api", () => ({
    fetchWorkflowAgentFlags: (...args: unknown[]) => fetchWorkflowAgentFlags(...args),
    queryWorkflows: (...args: unknown[]) => queryWorkflows(...args),
    fetchWorkflowsBatch: vi.fn(),
}))

const {ensureAgentFlags} = await import("../../src/workflow/state/helpers")

describe("ensureAgentFlags", () => {
    beforeEach(() => {
        fetchWorkflowAgentFlags.mockReset()
        queryWorkflows.mockReset()
        getDefaultStore().set(queryClientAtom, new QueryClient())
    })

    it("serves every consumer in a project from ONE fetch", async () => {
        queryWorkflows.mockResolvedValue({count: 2, workflows: [{id: "a"}, {id: "b"}]})
        fetchWorkflowAgentFlags.mockResolvedValue(
            new Map([
                ["a", true],
                ["b", false],
            ]),
        )

        // Two independent callers — the sidebar and a list page, say — in the same project.
        const [first, second] = await Promise.all([
            ensureAgentFlags("project-1"),
            ensureAgentFlags("project-1"),
        ])
        const third = await ensureAgentFlags("project-1")

        expect(fetchWorkflowAgentFlags).toHaveBeenCalledTimes(1)
        expect(queryWorkflows).toHaveBeenCalledTimes(1)
        expect(first.get("a")).toBe(true)
        expect(second.get("b")).toBe(false)
        expect(third).toBe(first)
    })

    it("includes archived workflows, so the archived Agents tab can be classified", async () => {
        queryWorkflows.mockResolvedValue({count: 0, workflows: []})
        fetchWorkflowAgentFlags.mockResolvedValue(new Map())

        await ensureAgentFlags("project-1")

        expect(queryWorkflows).toHaveBeenCalledWith(
            expect.objectContaining({includeArchived: true, flags: {is_evaluator: false}}),
        )
    })

    it("resolves empty without fetching when there is no project", async () => {
        expect((await ensureAgentFlags(null)).size).toBe(0)
        expect(fetchWorkflowAgentFlags).not.toHaveBeenCalled()
    })
})
