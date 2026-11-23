/**
 * A revision the database does not hold is read by reference (`POST /workflows/revisions/retrieve`),
 * which also serves static catalog revisions: a reserved `__ag__*` agent has no row, and its listed
 * drives still show in the files pane.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {atom, createStore, type Atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const fern = vi.hoisted(() => ({
    queryMounts: vi.fn(),
    queryAgentMount: vi.fn(),
    retrieveWorkflowRevision: vi.fn(),
}))

// The database read of a revision: `found` holds what `/workflows/revisions/query` answered.
const stored = vi.hoisted(() => ({found: new Map<string, Record<string, unknown> | null>()}))

vi.mock("@agenta/sdk/resources", () => ({
    getMountsClient: () => fern,
    getLowPriorityMountsClient: () => fern,
    getSessionsClient: () => ({}),
    getLowPrioritySessionsClient: () => ({}),
    getWorkflowsClient: () => fern,
    getLowPriorityWorkflowsClient: () => fern,
}))

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>()
    const revision = (id: string) => stored.found.get(id) ?? null
    return {
        ...actual,
        workflowMolecule: {
            selectors: {
                parameters: (id: string) =>
                    atom(() => (revision(id)?.data as {parameters?: unknown})?.parameters),
                query: (id: string) =>
                    atom(() => ({data: revision(id), isPending: false, isError: false})),
            },
            atoms: {query: () => atom(() => ({refetch: () => undefined}))},
        },
    }
})

import {agentDrivesStateAtom, type AgentDrivesState} from "../../src/drive/drives"

const STATIC_REVISION = "8a1c7d62-5f0e-5b55-9b1a-2f6e8e0c3d41"
const STATIC_AGENT = "4b0d9e1a-7c2f-5a3e-8d6b-1e9f0a2c4b57"
const LEARNING = {id: "m-learning", slug: "__ag__test_agent__learning"}

async function settle(target: Atom<AgentDrivesState>): Promise<AgentDrivesState> {
    const store = createStore()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, "p1")
    const unsub = store.sub(target, () => undefined)
    await vi.waitFor(() => expect(store.get(target).isPending).toBe(false))
    const value = store.get(target)
    unsub()
    return value
}

beforeEach(() => {
    fern.queryMounts.mockReset()
    fern.queryAgentMount.mockReset()
    fern.retrieveWorkflowRevision.mockReset()
    stored.found.clear()
})

describe("the drives of a revision the database does not hold", () => {
    it("reads a static revision by reference and shows its listed drive", async () => {
        fern.retrieveWorkflowRevision.mockResolvedValue({
            count: 1,
            workflow_revision: {
                id: STATIC_REVISION,
                workflow_id: STATIC_AGENT,
                data: {
                    uri: "agenta:builtin:agent:v0",
                    parameters: {
                        agent: {drives: [{slug: LEARNING.slug}], home_drive: null},
                    },
                },
            },
        })
        fern.queryMounts.mockResolvedValue({count: 1, mounts: [LEARNING]})

        const state = await settle(agentDrivesStateAtom(STATIC_REVISION, STATIC_AGENT))

        expect(fern.retrieveWorkflowRevision.mock.calls[0][0]).toEqual({
            workflow_revision_ref: {id: STATIC_REVISION},
        })
        expect(fern.queryMounts.mock.calls[0][0]).toEqual({mount: {slugs: [LEARNING.slug]}})
        expect(state.homeMount).toBeNull()
        expect(state.otherDrives).toEqual([
            {slug: LEARNING.slug, access: "read-write", mount: LEARNING},
        ])
        // Not the legacy lookup, which would show the drive as the home drive.
        expect(fern.queryAgentMount).not.toHaveBeenCalled()
    })

    it("keeps the lookup by the agent id when the reference resolves nothing", async () => {
        fern.retrieveWorkflowRevision.mockResolvedValue({count: 0, workflow_revision: null})
        fern.queryAgentMount.mockResolvedValue({count: 1, mounts: [{id: "m-own", slug: "own"}]})

        const state = await settle(agentDrivesStateAtom("r-gone", "a-gone"))

        expect(fern.queryAgentMount.mock.calls[0][0]).toEqual({artifact_id: "a-gone"})
        expect(state.homeMount).toEqual({id: "m-own", slug: "own"})
    })

    it("reports a failed read by reference as an error, not as the lookup by agent id", async () => {
        fern.retrieveWorkflowRevision.mockRejectedValue(new Error("server error"))

        const target = agentDrivesStateAtom("r-failed", "a-failed")
        const store = createStore()
        store.set(
            queryClientAtom,
            new QueryClient({defaultOptions: {queries: {retry: false, retryDelay: 0}}}),
        )
        store.set(projectIdAtom, "p1")
        const unsub = store.sub(target, () => undefined)
        await vi.waitFor(() => expect(store.get(target).isError).toBe(true))
        const state = store.get(target)
        unsub()

        expect(state.homeMount).toBeNull()
        expect(fern.queryAgentMount).not.toHaveBeenCalled()
    })

    it("does not read by reference a revision the database holds", async () => {
        stored.found.set("r-stored", {
            id: "r-stored",
            data: {parameters: {agent: {drives: [{slug: "price-lists"}], home_drive: null}}},
        })
        fern.queryMounts.mockResolvedValue({
            count: 1,
            mounts: [{id: "m-prices", slug: "price-lists"}],
        })

        const state = await settle(agentDrivesStateAtom("r-stored", "a-stored"))

        expect(state.otherDrives.map((d) => d.slug)).toEqual(["price-lists"])
        expect(fern.retrieveWorkflowRevision).not.toHaveBeenCalled()
    })
})
