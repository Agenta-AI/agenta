import {beforeEach, describe, expect, it, vi} from "vitest"

const post = vi.fn()
vi.mock("@agenta/shared/api", () => ({
    axios: {post: (...args: unknown[]) => post(...args), get: vi.fn()},
    getAgentaApiUrl: () => "http://api.test",
}))

import {findEvaluationRunsUsing} from "../../src/evaluationRun/api/api"
import type {Workflow} from "../../src/workflow/core"
import {selectEvaluators} from "../../src/workflow/core/selectEvaluators"

const workflow = (id: string, deletedAt: string | null = null): Workflow =>
    ({id, name: id, deleted_at: deletedAt}) as Workflow

const revision = (
    id: string,
    uri: string | undefined,
    flags: Record<string, boolean> = {is_managed: true},
): Workflow => ({id, data: uri ? {uri} : {}, flags}) as Workflow

const byWorkflow = (entries: [string, Workflow][]) => new Map(entries)

describe("selectEvaluators", () => {
    it("Only managed evaluators are listed", () => {
        const workflows = [workflow("a"), workflow("b")]
        const latest = byWorkflow([
            ["a", revision("ra", "agenta:builtin:auto_exact_match:v0")],
            ["b", revision("rb", "user:custom:main.Eval:latest", {is_managed: false})],
        ])
        const result = selectEvaluators(workflows, latest, {category: "automatic", mode: "active"})
        expect(result.map((entry) => entry.workflow.id)).toEqual(["a"])
    })

    it("A feedback URI makes an evaluator human", () => {
        const workflows = [workflow("a"), workflow("b")]
        const latest = byWorkflow([
            ["a", revision("ra", "agenta:builtin:feedback:v0")],
            ["b", revision("rb", "agenta:builtin:auto_exact_match:v0")],
        ])
        const human = selectEvaluators(workflows, latest, {category: "human", mode: "active"})
        const automatic = selectEvaluators(workflows, latest, {
            category: "automatic",
            mode: "active",
        })
        expect(human.map((entry) => entry.workflow.id)).toEqual(["a"])
        expect(automatic.map((entry) => entry.workflow.id)).toEqual(["b"])
    })

    it("Without a URI the feedback flag decides", () => {
        const workflows = [workflow("a"), workflow("b")]
        const latest = byWorkflow([
            ["a", revision("ra", undefined, {is_managed: true, is_feedback: true})],
            ["b", revision("rb", undefined, {is_managed: true})],
        ])
        const human = selectEvaluators(workflows, latest, {category: "human", mode: "active"})
        expect(human.map((entry) => entry.workflow.id)).toEqual(["a"])
    })

    it("Archived evaluators are sorted by archive date, newest first", () => {
        const workflows = [
            workflow("old", "2026-01-01T00:00:00Z"),
            workflow("new", "2026-03-01T00:00:00Z"),
            workflow("live"),
        ]
        const latest = byWorkflow(
            ["old", "new", "live"].map((id): [string, Workflow] => [
                id,
                revision(`r-${id}`, "agenta:builtin:auto_exact_match:v0"),
            ]),
        )
        const archived = selectEvaluators(workflows, latest, {
            category: "automatic",
            mode: "archived",
        })
        expect(archived.map((entry) => entry.workflow.id)).toEqual(["new", "old"])
        const active = selectEvaluators(workflows, latest, {category: "automatic", mode: "active"})
        expect(active.map((entry) => entry.workflow.id)).toEqual(["live"])
    })

    it("Live evaluators are sorted by their latest revision, newest first", () => {
        const workflows = [workflow("first"), workflow("second"), workflow("third")]
        const latest = byWorkflow([
            [
                "first",
                {
                    ...revision("r1", "agenta:builtin:auto_exact_match:v0"),
                    created_at: "2026-01-01T00:00:00Z",
                },
            ],
            [
                "second",
                {
                    ...revision("r2", "agenta:builtin:auto_exact_match:v0"),
                    created_at: "2026-03-01T00:00:00Z",
                },
            ],
            [
                "third",
                {
                    ...revision("r3", "agenta:builtin:auto_exact_match:v0"),
                    created_at: "2026-02-01T00:00:00Z",
                },
            ],
        ])
        const result = selectEvaluators(workflows, latest, {category: "automatic", mode: "active"})
        expect(result.map((entry) => entry.workflow.id)).toEqual(["second", "third", "first"])
    })

    it("A workflow without a latest revision is left out", () => {
        const result = selectEvaluators([workflow("a")], new Map(), {
            category: "automatic",
            mode: "active",
        })
        expect(result).toEqual([])
    })
})

describe("findEvaluationRunsUsing", () => {
    beforeEach(() => post.mockReset())

    it("The in-use check sends one query per evaluator and merges run ids", async () => {
        post.mockImplementation(async (_url: string, body?: {run: {references: unknown[]}}) => {
            const ref = body?.run.references[0] as {evaluator: {id: string}}
            return {
                data: {
                    runs:
                        ref?.evaluator.id === "e1"
                            ? [{id: "run-1"}, {id: "run-2"}]
                            : [{id: "run-2"}, {id: "run-3"}],
                },
            }
        })

        const runIds = await findEvaluationRunsUsing({
            projectId: "p1",
            references: [{evaluator: {id: "e1"}}, {evaluator: {id: "e2"}}],
        })

        expect(post).toHaveBeenCalledTimes(2)
        expect(post.mock.calls[0][1]).toEqual({run: {references: [{evaluator: {id: "e1"}}]}})
        expect(post.mock.calls[0][2]).toEqual({params: {project_id: "p1"}})
        expect([...runIds].sort()).toEqual(["run-1", "run-2", "run-3"])
    })

    it("No references send no request", async () => {
        expect(await findEvaluationRunsUsing({projectId: "p1", references: []})).toEqual([])
        expect(post).not.toHaveBeenCalled()
    })
})
