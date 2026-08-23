import {describe, expect, it} from "vitest"

import {resolveHomeSurface, type HomeSurfaceInput} from "../../src/features/onboarding/homeSurface"

const input = (overrides: Partial<HomeSurfaceInput> = {}): HomeSurfaceInput => ({
    agentCount: 0,
    isPending: false,
    isError: false,
    ...overrides,
})

describe("resolveHomeSurface", () => {
    it("gives a settled empty project the first-run hero", () => {
        expect(resolveHomeSurface(input())).toBe("first-run")
    })

    it("gives a project with agents the normal Home", () => {
        expect(resolveHomeSurface(input({agentCount: 3}))).toBe("home")
    })

    it("holds while an empty list is still resolving, so Home never flashes first", () => {
        expect(resolveHomeSurface(input({isPending: true}))).toBe("loading")
    })

    it("does not hold a returning user behind the skeleton when the list is cached", () => {
        expect(resolveHomeSurface(input({agentCount: 2, isPending: true}))).toBe("home")
    })

    it("treats a failed fetch as Home, never as evidence of emptiness", () => {
        // Desktop's rule: a failed fetch must not send someone who has agents into onboarding,
        // and Home is the surface that can be retried.
        expect(resolveHomeSurface(input({isError: true}))).toBe("home")
        expect(resolveHomeSurface(input({isError: true, isPending: true}))).toBe("home")
    })

    it("walks a cold first run: pending, then empty", () => {
        expect(resolveHomeSurface(input({isPending: true}))).toBe("loading")
        expect(resolveHomeSurface(input())).toBe("first-run")
    })
})
