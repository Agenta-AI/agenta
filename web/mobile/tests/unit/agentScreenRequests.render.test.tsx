// @vitest-environment jsdom
/**
 * Opening an agent screen adds no request (M3 gate, latency finding 4). The privacy control in
 * the top bar shows Private/Shared from the agent list row's policy, which the screen already
 * reads; the agent's sharing state and the members load when the panel opens.
 */
import {act, createElement} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {sharing, controlProps} = vi.hoisted(() => ({
    sharing: {
        fetchAgentSharing: vi.fn(),
        querySharingMembers: vi.fn(),
    },
    controlProps: [] as Record<string, unknown>[],
}))

vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getSharingClient: () => sharing,
}))
vi.mock("@agenta/shared/state", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/shared/state")>()),
        userAtom: mockAtom({id: "me", email: "me@acme.com", username: "Me"}),
    }
})
vi.mock("@agenta/entity-ui/sharing", () => ({
    AgentPrivacyControl: (props: Record<string, unknown>) => {
        controlProps.push(props)
        return null
    },
    AgentPrivacyDialog: () => null,
    sharingWriteResultFromError: () => "failed",
}))
vi.mock("../../src/features/context/useCurrentProject", () => ({
    useCurrentProject: () => ({project_name: "Acme support"}),
}))

import {AgentPrivacyHost} from "../../src/features/chat/AgentPrivacyHost"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    sharing.fetchAgentSharing.mockReset()
    sharing.fetchAgentSharing.mockReturnValue(new Promise(() => undefined))
    sharing.querySharingMembers.mockReset()
    sharing.querySharingMembers.mockReturnValue(new Promise(() => undefined))
    controlProps.length = 0
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const mount = () => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const store = createStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, "proj-1")
    act(() =>
        root.render(
            createElement(
                QueryClientProvider,
                {client},
                createElement(
                    Provider,
                    {store},
                    createElement(AgentPrivacyHost, {
                        agentId: "agent-1",
                        agentName: "Support triage",
                        workspaceId: "w-1",
                        projectId: "proj-1",
                        access: {visibility: "private", owner_user_id: "me"},
                    }),
                ),
            ),
        ),
    )
}

describe("the agent screen's privacy control", () => {
    it("shows the owner's private state from the list row with no request", async () => {
        mount()
        await act(async () => undefined)

        const props = controlProps.at(-1)!
        expect((props.sharing as {my_role: string}).my_role).toBe("owner")
        expect((props.sharing as {policy: {visibility: string}}).policy.visibility).toBe("private")
        expect(sharing.fetchAgentSharing).not.toHaveBeenCalled()
        expect(sharing.querySharingMembers).not.toHaveBeenCalled()
    })

    it("reads the sharing state and the members when the panel opens", async () => {
        mount()
        await act(async () => undefined)
        act(() => (controlProps.at(-1)!.onOpen as () => void)())
        await act(async () => undefined)

        expect(sharing.fetchAgentSharing).toHaveBeenCalledTimes(1)
        expect(sharing.querySharingMembers).toHaveBeenCalled()
    })
})

describe("the agent screen's privacy control on a cold load", () => {
    it("reads nothing while the agent list row is still loading", async () => {
        const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        const store = createStore()
        store.set(queryClientAtom, client)
        store.set(projectIdAtom, "proj-1")
        act(() =>
            root.render(
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(
                        Provider,
                        {store},
                        createElement(AgentPrivacyHost, {
                            agentId: "agent-1",
                            agentName: "Support triage",
                            workspaceId: "w-1",
                            projectId: "proj-1",
                            access: undefined,
                        }),
                    ),
                ),
            ),
        )
        await act(async () => undefined)
        expect(controlProps.at(-1)!.sharing).toBeUndefined()
        expect(sharing.fetchAgentSharing).not.toHaveBeenCalled()
        expect(sharing.querySharingMembers).not.toHaveBeenCalled()
    })
})
