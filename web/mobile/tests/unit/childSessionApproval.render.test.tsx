// @vitest-environment jsdom
/**
 * A child session's approval card in the calling chat. The card is the real shared card; the API
 * is mocked at `@agenta/entities/session`, so what is asserted is the request the card sends: the
 * answer goes to the CHILD's interaction, never to the calling session. A reader who cannot send
 * in the child sees the card with no buttons.
 */
import {act} from "react"

import {actionableInteractionsQueryKey} from "@agenta/sessions/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => ({
    queryInteractions: vi.fn(),
    respondInteraction: vi.fn(),
    querySessionStreams: vi.fn(),
}))
const access = vi.hoisted(() => ({
    sharing: undefined as Record<string, unknown> | undefined,
}))

vi.mock("@agenta/entities/session", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/session")>()),
    queryInteractions: (...args: unknown[]) => api.queryInteractions(...args),
    respondInteraction: (...args: unknown[]) => api.respondInteraction(...args),
    querySessionStreams: (...args: unknown[]) => api.querySessionStreams(...args),
}))
// The child's sharing state, as its row would carry it.
vi.mock("@/features/chat/useSessionSharing", () => ({
    useSessionSharing: () => ({
        query: {isError: false},
        sharing: access.sharing,
        ownerName: "Ana",
    }),
}))
vi.mock("@/features/chat/steer", () => ({
    isSteerEnabled: () => false,
    buildApprovalAnswer: (approved: boolean) => ({approved}),
}))
vi.mock("@/components/ContentRail", () => ({
    ContentRail: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))

import {ChildSessionApproval} from "../../src/features/chat/ChildSessionApproval"

const CHILD = "child-session"
const approval = {approvalId: "gate-1", toolName: "send_email", input: {to: "ana@example.com"}}
const sharingThatSends = {
    policy: {owner_user_id: "ana"},
    owner_is_active: true,
    grants: [],
    my_role: "owner",
    can_send: true,
    shareable: true,
}

let host: HTMLDivElement
let root: Root

const flush = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))))

let client: QueryClient

const mount = async (approvals = [approval]) => {
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <Provider store={createStore()}>
                    <ChildSessionApproval
                        sessionId={CHILD}
                        approvals={approvals}
                        projectId="proj-1"
                        workspaceId="ws-1"
                        bottomMost={false}
                    />
                </Provider>
            </QueryClientProvider>,
        ),
    )
    await flush()
}

const button = (label: string) =>
    [...host.querySelectorAll("button")].find((node) => node.textContent?.includes(label))

beforeEach(() => {
    api.queryInteractions.mockReset()
    api.respondInteraction.mockReset()
    api.querySessionStreams.mockReset()
    api.querySessionStreams.mockResolvedValue([
        {project_id: "proj-1", session_id: CHILD, name: "Email writer"},
    ])
    access.sharing = sharingThatSends
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("a child session's approval in the calling chat", () => {
    it("names the child session that asks, with a link to it", async () => {
        await mount()
        const link = host.querySelector("a")
        expect(link?.textContent).toBe("Email writer")
        expect(link?.getAttribute("href")).toContain(CHILD)
    })

    it("sends the answer to the child's interaction, not to the calling session", async () => {
        api.queryInteractions.mockResolvedValue([
            {
                id: "child-interaction",
                session_id: CHILD,
                turn_id: "child-exec",
                token: "gate-1",
                kind: "user_approval",
                status: "pending",
            },
        ])
        api.respondInteraction.mockResolvedValue({accepted: true})
        await mount()

        await act(async () => button("Approve")?.click())
        await flush()

        expect(api.queryInteractions).toHaveBeenCalledWith(
            expect.objectContaining({sessionId: CHILD, actionableOnly: true}),
        )
        expect(api.respondInteraction).toHaveBeenCalledTimes(1)
        expect(api.respondInteraction.mock.calls[0][0]).toMatchObject({
            interactionId: "child-interaction",
            projectId: "proj-1",
            expectedExecutionId: "child-exec",
            answer: {approved: true},
        })
    })

    it("re-reads the project's waiting sessions once the answer is sent", async () => {
        api.queryInteractions.mockResolvedValue([
            {
                id: "child-interaction",
                session_id: CHILD,
                turn_id: "child-exec",
                token: "gate-1",
                kind: "user_approval",
                status: "pending",
            },
        ])
        api.respondInteraction.mockResolvedValue({accepted: true})
        await mount()
        const invalidate = vi.spyOn(client, "invalidateQueries")

        await act(async () => button("Approve")?.click())
        await flush()

        expect(invalidate).toHaveBeenCalledWith({
            queryKey: actionableInteractionsQueryKey("proj-1"),
        })
    })

    it("shows no buttons to a member who cannot send in the child session", async () => {
        access.sharing = {...sharingThatSends, my_role: "viewer", can_send: false}
        await mount()

        expect(host.textContent).toContain("Needs your approval")
        expect(button("Approve")).toBeUndefined()
        expect(button("Deny")).toBeUndefined()
        expect(host.textContent).toContain("Waiting for Ana")
    })

    it("shows no buttons while the child's sharing state is not known", async () => {
        access.sharing = undefined
        await mount()

        expect(button("Approve")).toBeUndefined()
    })

    it("binds no keyboard shortcut: Cmd+Enter in the calling chat answers nothing here", async () => {
        await mount()
        await act(async () => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", {key: "Enter", metaKey: true, bubbles: true}),
            )
        })
        await flush()

        expect(api.queryInteractions).not.toHaveBeenCalled()
        expect(api.respondInteraction).not.toHaveBeenCalled()
    })
})
