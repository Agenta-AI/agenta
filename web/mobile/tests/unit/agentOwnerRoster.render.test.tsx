// @vitest-environment jsdom
/**
 * The agent list names owners from the PROJECT's member roster, read page by page. Someone
 * removed from the project, though still in the organization, reads "Former member".
 */
import {act} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const sharing = vi.hoisted(() => ({querySharingMembers: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getSharingClient: () => sharing,
    getSessionsClient: vi.fn(),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {agentOwnerLabel} from "@/features/agents/agentListView"
import {useAgentOwners} from "@/features/agents/useAgentOwners"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
let seen: ReturnType<typeof useAgentOwners>

const Probe = () => {
    seen = useAgentOwners()
    return null
}

beforeEach(() => {
    sharing.querySharingMembers.mockReset()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the agent list's owner names", () => {
    it("come from every page of the project roster; an id outside it is a former member", async () => {
        // Bob is on the second page. Carol is still in the organization but not in this project,
        // so the roster never holds her.
        sharing.querySharingMembers
            .mockResolvedValueOnce({
                count: 1,
                members: [{user_id: "alice", email: "alice@example.com", name: "Alice Martin"}],
                windowing: {next: "alice", limit: 500},
            })
            .mockResolvedValueOnce({
                count: 1,
                members: [{user_id: "bob", email: "bob@example.com", name: null}],
            })
        const store = createStore()
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(projectIdAtom, "proj-1")

        await act(async () =>
            root.render(
                <Provider store={store}>
                    <Probe />
                </Provider>,
            ),
        )
        await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)))

        expect(sharing.querySharingMembers).toHaveBeenCalledTimes(2)
        expect(seen.owners.map((owner) => owner.name)).toEqual(["Alice Martin", "bob@example.com"])
        expect(agentOwnerLabel("bob", "me", seen.ownerNames)).toBe("bob@example.com")
        expect(agentOwnerLabel("carol", "me", seen.ownerNames)).toBe("Former member")
    })
})
