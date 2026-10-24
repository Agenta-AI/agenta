// @vitest-environment jsdom
/**
 * A brand-new chat gets its Share button without a reload (QA D1). The button reads the reader's
 * sharing state from the session row; the row does not exist before the first message, and the
 * row read runs again when the session changes (the first turn invalidates it), so the button
 * appears then. Before the fix it waited on a sharing read that answered 404 and was not retried.
 */
import {act, createElement} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const rows = vi.hoisted(() => ({querySessionStreams: vi.fn()}))
vi.mock("@agenta/entities/session", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/session")>()),
    querySessionStreams: (...args: unknown[]) => rows.querySessionStreams(...args),
}))
vi.mock("@agenta/sessions-ui/sharing", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sessions-ui/sharing")>()),
    SessionShareButton: () => createElement("button", {"data-testid": "share"}, "Share"),
}))

import {SessionSharingControl} from "@/features/chat/SessionSharingControl"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    rows.querySessionStreams.mockReset()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const ownerRow = [
    {
        project_id: "proj-1",
        session_id: "new-chat",
        sharing: {
            policy: {visibility: "private", owner_user_id: "me"},
            owner_is_active: true,
            grants: [],
            my_role: "owner",
            can_send: true,
            shareable: true,
        },
    },
]

describe("a brand-new chat", () => {
    it("shows Share once the first turn created its row, without a reload", async () => {
        rows.querySessionStreams.mockResolvedValueOnce([]) // no row before the first message
        const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        const store = createStore()
        store.set(queryClientAtom, client)
        store.set(projectIdAtom, "proj-1")
        await act(async () =>
            root.render(
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(
                        Provider,
                        {store},
                        createElement(SessionSharingControl, {
                            sessionId: "new-chat",
                            sessionName: "New chat",
                            workspaceId: "w-1",
                            projectId: "proj-1",
                        }),
                    ),
                ),
            ),
        )
        await act(async () => undefined)
        expect(host.querySelector('[data-testid="share"]')).toBeNull()

        // The first turn lands: the session change invalidates the row read.
        rows.querySessionStreams.mockResolvedValue(ownerRow)
        await act(async () => {
            await client.invalidateQueries({
                predicate: (query) => query.queryKey.includes("session-stream"),
            })
        })
        expect(host.querySelector('[data-testid="share"]')).not.toBeNull()
    })
})
