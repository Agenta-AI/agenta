import {describe, expect, it} from "vitest"

import {resolveHomeSurface, type HomeSurfaceInput} from "../../src/features/home/homeSurface"

const input = (overrides: Partial<HomeSurfaceInput> = {}): HomeSurfaceInput => ({
    agentCount: 0,
    isPending: false,
    isError: false,
    onboardingFlow: false,
    onboardingPreview: false,
    onboardingShown: false,
    ...overrides,
})

describe("resolveHomeSurface", () => {
    it("gives a settled empty project Home, which opens on templates", () => {
        expect(resolveHomeSurface(input())).toBe("home")
    })

    it("gives a project with agents the same Home", () => {
        expect(resolveHomeSurface(input({agentCount: 3}))).toBe("home")
    })

    it("holds while an empty list is still resolving, so the tabs never flip on arrival", () => {
        expect(resolveHomeSurface(input({isPending: true}))).toBe("loading")
    })

    it("does not hold a returning user behind the skeleton when the list is cached", () => {
        expect(resolveHomeSurface(input({agentCount: 2, isPending: true}))).toBe("home")
    })

    it("treats a failed fetch as Home, never as evidence of emptiness", () => {
        // A failed fetch must not be read as "no agents"; Home is the surface that can be retried.
        expect(resolveHomeSurface(input({isError: true}))).toBe("home")
        expect(resolveHomeSurface(input({isError: true, isPending: true}))).toBe("home")
    })

    it("walks a cold start: hold while pending, then Home once it settles empty", () => {
        expect(resolveHomeSurface(input({isPending: true}))).toBe("loading")
        expect(resolveHomeSurface(input())).toBe("home")
    })

    it("opens a settled empty project on the guided flow when it is enabled", () => {
        const flow = {onboardingFlow: true}
        expect(resolveHomeSurface(input(flow))).toBe("onboarding")
        expect(resolveHomeSurface(input({...flow, isPending: true}))).toBe("loading")
        expect(resolveHomeSurface(input({...flow, agentCount: 1}))).toBe("home")
        expect(resolveHomeSurface(input({...flow, isError: true}))).toBe("home")
    })

    it("previews the flow on any project only while the flow is enabled", () => {
        const preview = {onboardingPreview: true, agentCount: 4}
        expect(resolveHomeSurface(input({...preview, onboardingFlow: true}))).toBe("onboarding")
        expect(resolveHomeSurface(input(preview))).toBe("home")
    })

    it("keeps the flow up once shown, even after the create fills the agent list", () => {
        const shown = {onboardingFlow: true, onboardingShown: true, agentCount: 1}
        expect(resolveHomeSurface(input(shown))).toBe("onboarding")
        expect(resolveHomeSurface(input({...shown, isPending: true}))).toBe("onboarding")
        expect(resolveHomeSurface(input({...shown, onboardingFlow: false}))).toBe("home")
    })
})
