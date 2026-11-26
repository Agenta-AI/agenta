// @vitest-environment jsdom
// Signing out drops every cached permission answer, so the next person in this tab is asked
// again before a gated read (traces included) can open on the previous person's answer.
import {act} from "react"

import {QueryClient} from "@tanstack/react-query"
import {createRoot} from "react-dom/client"
import {describe, expect, it, vi} from "vitest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const client = vi.hoisted(() => ({current: null as unknown}))

vi.mock("@/lib/queryClient", async () => {
    const {QueryClient: Client} = await import("@tanstack/react-query")
    client.current = new Client()
    return {queryClient: client.current}
})
vi.mock("next/router", () => ({useRouter: () => ({replace: vi.fn()})}))
vi.mock("@/lib/auth", () => ({signOut: async () => undefined}))
vi.mock("@/lib/context", () => ({clearLastContext: () => undefined}))
vi.mock("@/features/analytics/client", () => ({resetAnalytics: async () => undefined}))
vi.mock("@/features/chat/useSessionTranscript", () => ({
    clearTranscriptSnapshots: () => undefined,
}))

import {useLogout} from "@/features/auth/useLogout"

describe("useLogout", () => {
    it("removes every cached permission answer", async () => {
        const queryClient = client.current as QueryClient
        queryClient.setQueryData(["project-permission", "proj-1", "view_spans"], true)
        queryClient.setQueryData(["profile"], {id: "u-1"})

        let logout: (() => Promise<void>) | undefined
        const Probe = () => {
            logout = useLogout()
            return null
        }
        const host = document.createElement("div")
        const root = createRoot(host)
        act(() => root.render(<Probe />))

        await act(async () => logout!())

        expect(queryClient.getQueryData(["project-permission", "proj-1", "view_spans"])).toBe(
            undefined,
        )
        act(() => root.unmount())
    })
})
