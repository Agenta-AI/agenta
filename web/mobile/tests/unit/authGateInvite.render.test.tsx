// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    replace: vi.fn(),
    router: {} as Record<string, unknown>,
    session: {kind: "ok"} as unknown,
}))

vi.mock("next/router", () => ({useRouter: () => state.router}))
vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQuery: () => ({data: state.session}),
}))

import {AuthGate} from "@/features/app/AuthGate"
import {readPendingInvite} from "@/features/invite/pendingInvite"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const QUERY = {
    token: "t",
    email: "a@b.c",
    organization_id: "o1",
    workspace_id: "w1",
    project_id: "p1",
}

let root: Root

const route = (isReady: boolean, query: Record<string, string>) => {
    state.router = {isReady, query, pathname: "/auth", replace: state.replace}
}

const render = () => act(async () => root.render(<AuthGate />))

beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
    })
    state.replace.mockReset().mockResolvedValue(true)
    state.session = {kind: "ok"}
    root = createRoot(document.createElement("div"))
})

afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
})

describe("an invite link on /auth", () => {
    it("is kept for a signed-in person, even when the session answers before the query", async () => {
        route(false, {})
        await render()
        expect(state.replace).not.toHaveBeenCalled()

        route(true, QUERY)
        await render()
        expect(readPendingInvite()).toEqual(QUERY)
        expect(state.replace).toHaveBeenCalledWith("/")
    })

    it("is kept for a signed-out person, who stays to sign in", async () => {
        state.session = {kind: "unauthenticated"}
        route(true, QUERY)
        await render()
        expect(readPendingInvite()).toEqual(QUERY)
        expect(state.replace).not.toHaveBeenCalled()
    })

    it("keeps nothing on an ordinary sign-in link", async () => {
        state.session = {kind: "unauthenticated"}
        route(true, {email: "a@b.c"})
        await render()
        expect(readPendingInvite()).toBeNull()
    })
})
