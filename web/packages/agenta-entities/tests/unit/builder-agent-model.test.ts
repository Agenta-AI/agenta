/**
 * The builder's model on first use (`ensureBuilderAgentModel`).
 *
 * The builder ships with no model. When the revision a project reads has none, the web app
 * commits the new-agent default once; a revision with a model, a project with no candidate, and
 * a commit that lost to another one commit nothing more.
 */
import {beforeEach, describe, expect, it, vi} from "vitest"

const commitApi = vi.fn()
const retrieveApi = vi.fn()
const loadCandidates = vi.fn()

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {
        ...actual,
        commitWorkflowRevisionApi: (...args: unknown[]) => commitApi(...args),
        retrieveWorkflowRevision: (...args: unknown[]) => retrieveApi(...args),
    }
})

vi.mock("../../src/workflow/state/agentModelCandidates", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {...actual, loadAgentModelCandidates: (...args: unknown[]) => loadCandidates(...args)}
})

import type {Workflow} from "../../src/workflow/core"
import {ensureBuilderAgentModel} from "../../src/workflow/state/builderAgentModel"

const CANDIDATE = {
    modelId: "openrouter/some-model",
    provider: "openrouter",
    mode: "agenta",
    slug: "openrouter",
    namespace: null,
    harness: "pi",
    source: "connection",
    connectionKey: "conn-1",
    managed: false,
}

const builder = (agent: Record<string, unknown>): Workflow =>
    ({
        id: "catalog-revision",
        workflow_id: "builder-artifact",
        workflow_variant_id: "builder-variant",
        data: {
            uri: "agenta:builtin:agent:v0",
            parameters: {agent: {instructions: {agents_md: "x"}, harness: {kind: "claude"}, ...agent}},
        },
    }) as unknown as Workflow

const ready = (candidates: unknown[]) => ({
    status: "ready",
    candidates,
    connections: [],
    capabilities: null,
    error: null,
})

const run = (revision: Workflow) =>
    ensureBuilderAgentModel({projectId: "proj-1", userId: "user-1", revision})

beforeEach(() => {
    commitApi.mockReset()
    retrieveApi.mockReset()
    loadCandidates.mockReset()
})

describe("ensureBuilderAgentModel", () => {
    it("commits the default pick on the read revision when it has no model", async () => {
        loadCandidates.mockResolvedValue(ready([CANDIDATE]))
        const committed = {id: "stored-revision"} as Workflow
        commitApi.mockResolvedValue(committed)

        const result = await run(builder({}))

        expect(result).toBe(committed)
        expect(commitApi).toHaveBeenCalledTimes(1)
        const [projectId, payload] = commitApi.mock.calls[0]
        expect(projectId).toBe("proj-1")
        expect(payload.workflowId).toBe("builder-artifact")
        expect(payload.variantId).toBe("builder-variant")
        expect(payload.baseRevisionId).toBe("catalog-revision")
        const agent = payload.data.parameters.agent
        expect(agent.llm.model).toBe("openrouter/some-model")
        expect(agent.harness.kind).toBe("pi")
        expect(agent.instructions).toEqual({agents_md: "x"})
    })

    it("commits nothing when the revision already has a model", async () => {
        const revision = builder({llm: {model: "chosen"}})

        expect(await run(revision)).toBe(revision)
        expect(loadCandidates).not.toHaveBeenCalled()
        expect(commitApi).not.toHaveBeenCalled()
    })

    it("commits nothing when no candidate exists", async () => {
        loadCandidates.mockResolvedValue(ready([]))
        const revision = builder({})

        expect(await run(revision)).toBe(revision)
        expect(commitApi).not.toHaveBeenCalled()
    })

    it("never picks an organization connection on its own", async () => {
        loadCandidates.mockResolvedValue(ready([{...CANDIDATE, scope: "organization"}]))

        await run(builder({}))

        expect(commitApi).not.toHaveBeenCalled()
    })

    it("commits nothing while the candidate sources are not ready", async () => {
        loadCandidates.mockResolvedValue({...ready([CANDIDATE]), status: "error"})

        await run(builder({}))

        expect(commitApi).not.toHaveBeenCalled()
    })

    it("reads the current revision and does not retry when the commit loses", async () => {
        loadCandidates.mockResolvedValue(ready([CANDIDATE]))
        commitApi.mockRejectedValue(
            Object.assign(new Error("conflict"), {response: {status: 409}}),
        )
        const current = {id: "someone-elses-revision"} as Workflow
        retrieveApi.mockResolvedValue(current)

        expect(await run(builder({}))).toBe(current)
        expect(commitApi).toHaveBeenCalledTimes(1)
        expect(retrieveApi).toHaveBeenCalledWith({
            projectId: "proj-1",
            workflowRef: {id: "builder-artifact"},
        })
    })

    it("keeps the read revision and does not read again when the commit is refused", async () => {
        loadCandidates.mockResolvedValue(ready([CANDIDATE]))
        commitApi.mockRejectedValue(
            Object.assign(new Error("forbidden"), {response: {status: 403}}),
        )
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const revision = builder({})

        expect(await run(revision)).toBe(revision)
        expect(retrieveApi).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })
})
