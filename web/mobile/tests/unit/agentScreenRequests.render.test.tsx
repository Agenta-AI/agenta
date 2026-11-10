// @vitest-environment jsdom
/**
 * Opening an agent screen adds no request (M3 gate, latency finding 4). The Share panel
 * starts from the agent list row's policy, which the screen already reads; the agent's sharing
 * state and the members load when Share opens.
 */
import {act, createElement} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {sharing, dialogProps, workflows} = vi.hoisted(() => ({
    sharing: {
        fetchAgentSharing: vi.fn(),
        querySharingMembers: vi.fn(),
    },
    dialogProps: [] as Record<string, unknown>[],
    workflows: {current: undefined as Record<string, unknown>[] | undefined},
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
vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
        agentWorkflowsListQueryStateAtom: mockAtom(() => ({data: workflows.current})),
    }
})
vi.mock("@agenta/entity-ui/sharing", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entity-ui/sharing")>()),
    AgentPrivacyDialog: (props: Record<string, unknown>) => {
        dialogProps.push(props)
        return null
    },
}))
vi.mock("../../src/features/agents/useAgentPublishPanel", () => ({
    useAgentPublishPanel: () => ({openHub: vi.fn(), reload: vi.fn(), panel: null}),
}))
vi.mock("../../src/features/chat/useSessionHeader", () => ({
    useSessionHeader: () => ({data: null}),
}))
vi.mock("../../src/features/context/useCurrentProject", () => ({
    useCurrentProject: () => ({project_name: "Acme support"}),
}))

import {ShareMenu} from "../../src/features/chat/ShareMenu"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    sharing.fetchAgentSharing.mockReset()
    sharing.fetchAgentSharing.mockReturnValue(new Promise(() => undefined))
    sharing.querySharingMembers.mockReset()
    sharing.querySharingMembers.mockReturnValue(new Promise(() => undefined))
    dialogProps.length = 0
    workflows.current = [
        {
            id: "agent-1",
            name: "Support triage",
            access: {visibility: "private", owner_user_id: "me"},
        },
    ]
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
                    createElement(ShareMenu, {
                        agentId: "agent-1",
                        sessionId: "session-1",
                        sessionName: "Refund question",
                        showSession: true,
                        canRequestTemplate: true,
                        workspaceId: "w-1",
                        projectId: "proj-1",
                        phone: false,
                    }),
                ),
            ),
        ),
    )
}

const openShare = async () => {
    await act(async () =>
        document.querySelector<HTMLButtonElement>('[data-testid="share-menu-share"]')?.click(),
    )
}

describe("the agent screen's Share panel", () => {
    it("holds the owner's private state from the list row with no request", async () => {
        mount()
        await act(async () => undefined)

        const props = dialogProps.at(-1)!
        expect((props.sharing as {my_role: string}).my_role).toBe("owner")
        expect((props.sharing as {policy: {visibility: string}}).policy.visibility).toBe("private")
        expect(sharing.fetchAgentSharing).not.toHaveBeenCalled()
        expect(sharing.querySharingMembers).not.toHaveBeenCalled()
    })

    it("reads the sharing state and the members when Share opens", async () => {
        mount()
        await act(async () => undefined)
        await openShare()

        expect(sharing.fetchAgentSharing).toHaveBeenCalledTimes(1)
        expect(sharing.querySharingMembers).toHaveBeenCalled()
        // The read is still in flight: the panel answers from the list row.
        expect(document.body.textContent).toContain("Only you can see and use it in Agenta.")
    })
})

describe("the agent screen's Share panel on a cold load", () => {
    it("reads nothing while the agent list row is still loading", async () => {
        workflows.current = undefined
        mount()
        await act(async () => undefined)

        expect(dialogProps.at(-1)!.sharing).toBeUndefined()
        expect(sharing.fetchAgentSharing).not.toHaveBeenCalled()
        expect(sharing.querySharingMembers).not.toHaveBeenCalled()

        await openShare()
        expect(sharing.fetchAgentSharing).toHaveBeenCalledTimes(1)
    })
})
