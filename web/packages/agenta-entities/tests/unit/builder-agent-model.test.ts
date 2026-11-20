/**
 * The builder's default model (`commitBuilderDefaultModel` and the builder revision query).
 *
 * The builder ships with no model. The builder revision query loads at once and never waits on
 * the model sources. In the background, when the loaded builder has no model and the sources
 * answer with a model the default rule may pick, the web app commits it once and reads the
 * builder again. A failing source means no commit.
 */
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {atom, getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const commitApi = vi.fn()
const retrieveApi = vi.fn()

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {
        ...actual,
        commitWorkflowRevisionApi: (...args: unknown[]) => commitApi(...args),
        retrieveWorkflowRevision: (...args: unknown[]) => retrieveApi(...args),
    }
})

// The model sources, as the candidates atom reports them. The real atom reads the vault, the
// harness catalog, the built-in models and the subscription status.
const candidatesState = atom<unknown>({status: "loading", candidates: []})
vi.mock("../../src/workflow/state/agentModelCandidates", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {...actual, agentModelCandidatesAtomFamily: () => candidatesState}
})

import type {Workflow} from "../../src/workflow/core"
import {builderAgentRevisionIdQueryAtom} from "../../src/workflow/state/builderAgent"
import {commitBuilderDefaultModel} from "../../src/workflow/state/builderAgentModel"

const CANDIDATE = {
    modelId: "openrouter/some-model",
    provider: "openrouter",
    mode: "agenta",
    slug: "openrouter",
    namespace: null,
    harness: "pi_core",
    source: "connection",
    connectionKey: "conn-1",
    managed: false,
} as const

const builder = (id: string, agent: Record<string, unknown>): Workflow =>
    ({
        id,
        workflow_id: "builder-artifact",
        workflow_variant_id: "builder-variant",
        data: {
            uri: "agenta:builtin:agent:v0",
            parameters: {
                agent: {instructions: {agents_md: "x"}, harness: {kind: "claude"}, ...agent},
            },
        },
    }) as unknown as Workflow

const ready = (candidates: unknown[]) => ({
    status: "ready",
    candidates,
    connections: [],
    capabilities: null,
    error: null,
})

const failed = (status: number) => ({
    status: "error",
    candidates: [],
    connections: [],
    capabilities: null,
    error: Object.assign(new Error("refused"), {response: {status}}),
})

beforeEach(() => {
    commitApi.mockReset()
    retrieveApi.mockReset()
})

describe("commitBuilderDefaultModel", () => {
    const run = () =>
        commitBuilderDefaultModel({
            projectId: "proj-1",
            revision: builder("catalog-revision", {}),
            selection: CANDIDATE as never,
        })

    it("commits the pick on the read revision", async () => {
        commitApi.mockResolvedValue({id: "stored-revision"})

        expect(await run()).toBe(true)
        const [projectId, payload] = commitApi.mock.calls[0]
        expect(projectId).toBe("proj-1")
        expect(payload.workflowId).toBe("builder-artifact")
        expect(payload.variantId).toBe("builder-variant")
        expect(payload.baseRevisionId).toBe("catalog-revision")
        expect(payload.data.parameters.agent.llm.model).toBe("openrouter/some-model")
        expect(payload.data.parameters.agent.harness.kind).toBe("pi_core")
        expect(payload.data.parameters.agent.instructions).toEqual({agents_md: "x"})
    })

    it("reports a change on a conflict, and does not commit again", async () => {
        commitApi.mockRejectedValue(Object.assign(new Error("conflict"), {response: {status: 409}}))

        expect(await run()).toBe(true)
        expect(commitApi).toHaveBeenCalledTimes(1)
    })

    it("reports no change on any other refusal", async () => {
        commitApi.mockRejectedValue(
            Object.assign(new Error("forbidden"), {response: {status: 403}}),
        )
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

        expect(await run()).toBe(false)
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })
})

describe("the builder revision query", () => {
    const store = getDefaultStore()
    let queryClient: QueryClient

    beforeEach(() => {
        queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
        store.set(queryClientAtom, queryClient)
        store.set(projectIdAtom, `proj-${Math.random()}`)
        store.set(sessionAtom, true)
    })

    const builderId = () => store.get(builderAgentRevisionIdQueryAtom).data ?? null

    const waitFor = async (check: () => boolean) => {
        for (let i = 0; i < 100 && !check(); i++) {
            await new Promise((resolve) => setTimeout(resolve, 5))
        }
        expect(check()).toBe(true)
    }

    it.each([403, 500])(
        "loads at once and commits nothing when a model source fails (%i)",
        async (status) => {
            store.set(candidatesState, {status: "loading", candidates: []})
            retrieveApi.mockResolvedValue(builder("catalog-revision", {}))
            const unsubscribe = store.sub(builderAgentRevisionIdQueryAtom, () => undefined)

            // The sources have not answered, and the builder is already there.
            await waitFor(() => builderId() === "catalog-revision")

            store.set(candidatesState, failed(status))
            await new Promise((resolve) => setTimeout(resolve, 20))
            expect(builderId()).toBe("catalog-revision")
            expect(commitApi).not.toHaveBeenCalled()
            unsubscribe()
        },
    )

    it("commits a usable model that arrives later once, then reads the builder again", async () => {
        store.set(candidatesState, {status: "loading", candidates: []})
        retrieveApi.mockResolvedValue(builder("catalog-revision", {}))
        commitApi.mockResolvedValue({id: "stored-revision"})
        const unsubscribe = store.sub(builderAgentRevisionIdQueryAtom, () => undefined)
        await waitFor(() => builderId() === "catalog-revision")
        expect(commitApi).not.toHaveBeenCalled()

        retrieveApi.mockResolvedValue(builder("stored-revision", {llm: {model: "picked"}}))
        store.set(candidatesState, ready([CANDIDATE]))

        await waitFor(() => builderId() === "stored-revision")
        expect(commitApi).toHaveBeenCalledTimes(1)
        expect(commitApi.mock.calls[0][1].baseRevisionId).toBe("catalog-revision")

        // Another candidate update after the commit changes nothing.
        store.set(candidatesState, ready([CANDIDATE, {...CANDIDATE, connectionKey: "conn-2"}]))
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(commitApi).toHaveBeenCalledTimes(1)
        unsubscribe()
    })
})
