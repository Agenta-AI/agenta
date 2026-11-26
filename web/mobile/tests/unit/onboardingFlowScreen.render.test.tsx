// @vitest-environment jsdom
import {act} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    profile: {isPending: false, user: {id: "u1"}} as {isPending: boolean; user?: {id: string}},
    invited: false,
    mint: vi.fn((_active: boolean) => ({entityId: null, error: null, retry: vi.fn()})),
}))

vi.mock("@agenta/entities/profile", () => ({useProfile: () => state.profile}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/features/agents/useEphemeralAgent", () => ({useEphemeralAgent: state.mint}))
vi.mock("@/features/context/useBindProjectContext", () => ({useBindProjectContext: vi.fn()}))
vi.mock("@/features/onboarding/OnboardingFlowHost", () => ({OnboardingFlowHost: () => null}))
vi.mock("@/features/onboarding/onboardingPending", () => ({
    isOnboardingInvited: () => state.invited,
}))
vi.mock("@/features/onboarding/states/OnboardingFlowError", () => ({
    OnboardingFlowError: () => null,
}))
vi.mock("@/features/onboarding/states/OnboardingFlowSkeleton", () => ({
    OnboardingFlowSkeleton: () => null,
}))

import {OnboardingFlowScreen} from "@/features/onboarding/OnboardingFlowScreen"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const mount = () => {
    const root = createRoot(document.createElement("div"))
    act(() => root.render(<OnboardingFlowScreen workspaceId="w" projectId="p" />))
    return root
}

let root: ReturnType<typeof mount> | undefined

beforeEach(() => {
    state.profile = {isPending: false, user: {id: "u1"}}
    state.invited = false
    state.mint.mockClear()
})

afterEach(() => {
    act(() => root?.unmount())
})

describe("agent setup on the onboarding page", () => {
    it("does not start for an invited person, who only answers the questions", () => {
        state.invited = true
        root = mount()
        expect(state.mint).toHaveBeenLastCalledWith(false)
    })

    it("starts for a new account with no invite, once the profile is known", () => {
        state.profile = {isPending: true}
        root = mount()
        expect(state.mint).toHaveBeenLastCalledWith(false)
        act(() => root?.unmount())
        state.profile = {isPending: false, user: {id: "u1"}}
        root = mount()
        expect(state.mint).toHaveBeenLastCalledWith(true)
    })
})
