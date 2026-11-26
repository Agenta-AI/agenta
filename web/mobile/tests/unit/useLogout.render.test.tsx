// @vitest-environment jsdom
import {act} from "react"

import {QueryClient} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    log: [] as string[],
    client: null as unknown as QueryClient,
}))

vi.mock("next/router", () => ({
    useRouter: () => ({
        replace: async (url: string) => {
            const verdict = state.client.getQueryData<{kind: string}>(["mobile", "projects"])?.kind
            state.log.push(`replace ${url} (verdict ${verdict})`)
        },
    }),
}))
vi.mock("@/lib/auth", () => ({signOut: async () => undefined}))
vi.mock("@/features/analytics/client", () => ({resetAnalytics: async () => undefined}))
vi.mock("@/lib/context", () => ({clearLastContext: () => undefined}))
vi.mock("@/features/chat/useSessionTranscript", () => ({clearTranscriptSnapshots: () => undefined}))
vi.mock("@agenta/shared/api/persist", () => ({
    clearPersistedQueryCache: async () => {
        state.log.push(`persist cleared (cached ${state.client.getQueryCache().getAll().length})`)
    },
}))
vi.mock("@/lib/queryClient", () => ({
    get queryClient() {
        return state.client
    },
}))

import {useLogout} from "@/features/auth/useLogout"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root
let logout: () => Promise<void>

const Probe = () => {
    logout = useLogout()
    return null
}

beforeEach(async () => {
    state.log = []
    state.client = new QueryClient()
    state.client.setQueryData(["profile"], {id: "user-a"})
    state.client.setQueryData(["mobile", "projects"], {kind: "ok", projects: [{id: "p1"}]})
    root = createRoot(document.createElement("div"))
    await act(async () => root.render(<Probe />))
})

afterEach(() => {
    act(() => root.unmount())
})

describe("useLogout", () => {
    it("tells AuthGate the user is signed out before it redirects, then empties both caches", async () => {
        await act(() => logout())

        expect(state.log).toEqual([
            "replace /auth (verdict unauthenticated)",
            "persist cleared (cached 0)",
        ])
        expect(state.client.getQueryData(["profile"])).toBeUndefined()
        expect(state.client.getQueryData(["mobile", "projects"])).toBeUndefined()
    })
})
