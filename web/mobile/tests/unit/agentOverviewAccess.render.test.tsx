// @vitest-environment jsdom
/**
 * The agent overview page and privacy (QA D6). An agent the reader cannot see (private to
 * someone else, or unknown) shows the one not-found screen; the overview's Publish panel of the
 * reader's own private agent is in its private state (no Connect), as in the playground.
 */
import {act, createElement} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {workflows, retrieve} = vi.hoisted(() => ({
    workflows: {current: {data: [] as Record<string, unknown>[], isPending: false}},
    retrieve: vi.fn(),
}))

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
        agentWorkflowsListQueryStateAtom: mockAtom(() => workflows.current),
        retrieveWorkflowRevision: (...args: unknown[]) => retrieve(...args),
    }
})
vi.mock("@agenta/shared/state", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/shared/state")>()),
        userAtom: mockAtom({id: "me", email: "me@acme.com", username: "Me"}),
    }
})

import {useAgentOverviewAccess} from "../../src/features/agents/useAgentOverviewAccess"

let host: HTMLDivElement
let root: Root
let seen: ReturnType<typeof useAgentOverviewAccess>

const Probe = ({agentId}: {agentId: string}) => {
    seen = useAgentOverviewAccess({agentId, projectId: "proj-1"})
    return null
}

const mount = async (agentId: string) => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    await act(async () =>
        root.render(
            createElement(
                QueryClientProvider,
                {client},
                createElement(Provider, {store: createStore()}, createElement(Probe, {agentId})),
            ),
        ),
    )
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))))
}

beforeEach(() => {
    retrieve.mockReset()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the agent overview's access", () => {
    it("an agent the reader cannot see is not found", async () => {
        workflows.current = {data: [], isPending: false}
        retrieve.mockResolvedValue(null) // hidden answers like unknown
        await mount("hidden-agent")
        expect(seen.notFound).toBe(true)
    })

    it("an archived agent the reader can see is not 'not found'", async () => {
        workflows.current = {data: [], isPending: false}
        retrieve.mockResolvedValue({id: "rev-1", workflow_id: "archived-agent"})
        await mount("archived-agent")
        expect(seen.notFound).toBe(false)
    })

    it("the reader's own private agent is private for the Publish panel", async () => {
        workflows.current = {
            data: [
                {
                    id: "mine",
                    flags: {is_agent: true},
                    access: {visibility: "private", owner_user_id: "me"},
                },
            ],
            isPending: false,
        }
        await mount("mine")
        expect(seen.notFound).toBe(false)
        expect(seen.agentPrivate).toBe(true)
        expect(retrieve).not.toHaveBeenCalled()
    })
})
