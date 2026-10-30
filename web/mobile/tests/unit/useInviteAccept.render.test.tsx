// @vitest-environment jsdom
import {act, StrictMode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    accept: vi.fn(),
    replace: vi.fn(),
    logout: vi.fn(),
    success: vi.fn(),
    session: {kind: "ok"} as unknown,
    profile: vi.fn(),
}))

vi.mock("@agenta/entities/organization", () => ({acceptWorkspaceInvite: state.accept}))
vi.mock("@agenta/entities/profile", () => ({fetchProfile: vi.fn()}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: state.success}}))
vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQuery: () => ({data: state.session}),
}))
vi.mock("next/router", () => ({useRouter: () => ({replace: state.replace})}))
vi.mock("@/features/auth/useLogout", () => ({useLogout: () => state.logout}))
vi.mock("@/lib/queryClient", () => ({
    queryClient: {
        invalidateQueries: () => Promise.resolve(),
        fetchQuery: () => state.profile(),
    },
}))
vi.mock("@/lib/context", () => ({
    fetchProjects: vi.fn(),
    projectOnboardingUrl: ({workspaceId, projectId}: {workspaceId: string; projectId: string}) =>
        `/w/${workspaceId}/p/${projectId}/onboarding`,
    projectHomeUrl: ({workspaceId, projectId}: {workspaceId: string; projectId: string}) =>
        `/w/${workspaceId}/p/${projectId}/apps`,
}))

import {InviteAcceptScreen} from "@/features/invite/InviteAcceptScreen"
import {readPendingInvite, rememberInvite} from "@/features/invite/pendingInvite"
import {isOnboardingInvited, markOnboardingPending} from "@/features/onboarding/onboardingPending"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const INVITE = {
    token: "t",
    email: "a@b.c",
    organization_id: "o1",
    workspace_id: "w1",
    project_id: "p1",
}

let root: Root
let host: HTMLDivElement

const mount = () =>
    act(async () => {
        root.render(
            <StrictMode>
                <InviteAcceptScreen />
            </StrictMode>,
        )
    })

const button = (name: string) =>
    Array.from(host.querySelectorAll("button")).find((item) => item.textContent === name)

beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
    })
    state.accept.mockReset().mockResolvedValue({})
    state.replace.mockReset().mockResolvedValue(true)
    state.logout.mockReset()
    state.success.mockReset()
    state.session = {kind: "ok"}
    state.profile.mockReset().mockResolvedValue({id: "u1"})
    rememberInvite(INVITE)
    host = document.createElement("div")
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    vi.unstubAllGlobals()
})

describe("the invite accept screen", () => {
    it("accepts once, clears the invite, and opens the invited project", async () => {
        await mount()
        expect(state.accept).toHaveBeenCalledTimes(1)
        expect(state.accept).toHaveBeenCalledWith(
            {token: "t", email: "a@b.c", organizationId: "o1", workspaceId: "w1", projectId: "p1"},
            true,
        )
        expect(state.success).toHaveBeenCalledWith("You joined a new workspace!")
        expect(readPendingInvite()).toBeNull()
        expect(state.replace).toHaveBeenCalledWith("/w/o1/p/p1/apps")
    })

    it("sends a new account to the questions in the invited project", async () => {
        markOnboardingPending("u1")
        await mount()
        expect(isOnboardingInvited("u1")).toBe(true)
        expect(state.replace).toHaveBeenCalledWith("/w/o1/p/p1/onboarding")
    })

    it("treats an accepted invite as joined", async () => {
        state.accept.mockRejectedValue({
            response: {status: 409, data: {detail: {error: "INVITE_ALREADY_ACCEPTED"}}},
        })
        await mount()
        expect(state.success).toHaveBeenCalledWith("You already joined this workspace.")
        expect(state.replace).toHaveBeenCalledWith("/w/o1/p/p1/apps")
    })

    it("waits for a session and leaves the invite in place when signed out", async () => {
        state.session = {kind: "unauthenticated"}
        await mount()
        expect(state.accept).not.toHaveBeenCalled()
        expect(readPendingInvite()).toEqual(INVITE)
    })

    it("goes to the root when no invite is kept", async () => {
        localStorage.removeItem("agenta:mobile:pending-invite")
        await mount()
        expect(state.accept).not.toHaveBeenCalled()
        expect(state.replace).toHaveBeenCalledWith("/")
    })

    describe("with an email that is not the invited one", () => {
        beforeEach(() => {
            state.accept.mockRejectedValue({
                response: {status: 400, data: {detail: {error: "INVITE_EMAIL_MISMATCH"}}},
            })
        })

        it("shows the message and no retry", async () => {
            await mount()
            expect(host.textContent).toContain(
                "This invitation is not for you. Sign in with the invited account to accept it.",
            )
            expect(button("Retry")).toBeUndefined()
        })

        it("keeps the invite when the person switches account", async () => {
            await mount()
            act(() => button("Sign in with a different account")?.click())
            expect(state.logout).toHaveBeenCalled()
            expect(readPendingInvite()).toEqual(INVITE)
        })

        it("clears the invite when the person goes back", async () => {
            await mount()
            act(() => button("Go back to your workspaces")?.click())
            expect(readPendingInvite()).toBeNull()
            expect(state.replace).toHaveBeenCalledWith("/")
        })
    })

    it.each(["INVITE_EXPIRED", "INVITE_NOT_FOUND"])("clears the invite on %s", async (error) => {
        state.accept.mockRejectedValue({response: {status: 400, data: {detail: {error}}}})
        await mount()
        expect(host.textContent).toContain("Unable to accept invitation")
        expect(readPendingInvite()).toBeNull()
    })

    it("does not use the invite until it can tell a new account", async () => {
        markOnboardingPending("u1")
        state.profile.mockRejectedValueOnce(new Error("Network Error"))
        await mount()
        expect(state.accept).not.toHaveBeenCalled()
        expect(readPendingInvite()).toEqual(INVITE)
        await act(async () => button("Retry")?.click())
        expect(state.accept).toHaveBeenCalledTimes(1)
        expect(state.replace).toHaveBeenCalledWith("/w/o1/p/p1/onboarding")
    })

    it("retries an unknown failure", async () => {
        state.accept.mockRejectedValueOnce(new Error("Network Error"))
        await mount()
        expect(readPendingInvite()).toEqual(INVITE)
        await act(async () => button("Retry")?.click())
        expect(state.accept).toHaveBeenCalledTimes(2)
        expect(state.replace).toHaveBeenCalledWith("/w/o1/p/p1/apps")
    })
})
