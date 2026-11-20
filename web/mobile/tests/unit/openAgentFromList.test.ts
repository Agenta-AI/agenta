/**
 * A click on an agent in the Agents list opens its latest session with the agent sidebar, or a
 * new empty session when it has none.
 */
import {QueryClient} from "@tanstack/react-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const router = vi.hoisted(() => ({asPath: "/w/w1/p/p1/agents", push: vi.fn()}))
const startBlankSession = vi.hoisted(() => vi.fn())
const listPage = vi.hoisted(() => vi.fn())

vi.mock("next/router", () => ({default: router}))
vi.mock("@/features/chat/useStartBlankSession", () => ({startBlankSession}))
vi.mock("@agenta/entities/session", () => ({
    sessionListQueryOptions: (filters: {agentId: string}) => ({
        queryKey: ["session-list", filters.agentId],
        queryFn: () => listPage(filters),
    }),
}))

const {openAgentFromList} = await import("@/features/agent-pages/openAgentFromList")
const {currentSidebar} = await import("@/features/agent-sidebar/selectedSidebar")

const open = (agentId: string) =>
    openAgentFromList({
        queryClient: new QueryClient({defaultOptions: {queries: {retry: false}}}),
        base: "/w/w1/p/p1",
        projectId: "p1",
        agentId,
    })

describe("openAgentFromList", () => {
    beforeEach(() => {
        router.push.mockReset()
        startBlankSession.mockReset()
        listPage.mockReset()
    })

    it("opens the latest session and the agent sidebar, Back to the Agents list", async () => {
        listPage.mockResolvedValue({sessions: [{session_id: "s-latest"}]})
        await open("support")
        expect(router.push).toHaveBeenCalledWith("/w/w1/p/p1/sessions/s-latest")
        expect(startBlankSession).not.toHaveBeenCalled()
        expect(currentSidebar()).toEqual({kind: "agent", agentId: "support", from: "agents"})
    })

    it("starts a new session when the agent has none", async () => {
        listPage.mockResolvedValue({sessions: []})
        await open("email")
        expect(startBlankSession).toHaveBeenCalledWith("/w/w1/p/p1", "email")
        expect(router.push).not.toHaveBeenCalled()
    })

    it("starts a new session when the lookup fails", async () => {
        listPage.mockResolvedValue(null)
        await open("email")
        expect(startBlankSession).toHaveBeenCalledWith("/w/w1/p/p1", "email")
    })

    it("does nothing when the person moved to another page during the lookup", async () => {
        listPage.mockImplementation(async () => {
            router.asPath = "/w/w1/p/p1/settings"
            return {sessions: [{session_id: "s1"}]}
        })
        await open("support")
        router.asPath = "/w/w1/p/p1/agents"
        expect(router.push).not.toHaveBeenCalled()
        expect(startBlankSession).not.toHaveBeenCalled()
    })
})
