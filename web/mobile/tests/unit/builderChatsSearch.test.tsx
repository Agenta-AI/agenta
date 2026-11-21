// @vitest-environment jsdom
/**
 * The builder chats search is a server predicate: the term goes into the session list query
 * (which sends it as `session.search`, see the entities package's session list options test),
 * so it finds chats outside the loaded pages too.
 */
import {renderHook} from "@testing-library/react"
import {atom} from "jotai"
import {describe, expect, it, vi} from "vitest"

const listCalls: Record<string, unknown>[] = []

vi.mock("@agenta/entities/workflow", () => {
    // One atom per selector, as the molecule keeps them: a new atom per call re-renders forever.
    const workflowId = atom("builder-workflow")
    return {
        builderAgentRevisionIdQueryAtom: atom({
            data: "builder-revision",
            isError: false,
            isPending: false,
        }),
        workflowMolecule: {selectors: {workflowId: () => workflowId}},
    }
})

vi.mock("@agenta/sessions/state", () => ({
    useSessionList: (options: Record<string, unknown>) => {
        listCalls.push(options)
        return {data: {pages: []}, isError: false, isPending: false}
    },
    rowsFromPages: () => [],
}))

const {useBuilderChats} = await import("../../src/features/builder-page/useBuilderChats")

describe("the builder chats query", () => {
    it("passes the search term to the server query of the builder's sessions", () => {
        renderHook(() => useBuilderChats("refund"))
        expect(listCalls.at(-1)).toMatchObject({agentId: "builder-workflow", search: "refund"})
    })

    it("asks for every chat with no term", () => {
        renderHook(() => useBuilderChats())
        expect(listCalls.at(-1)).toMatchObject({agentId: "builder-workflow", search: ""})
    })
})
