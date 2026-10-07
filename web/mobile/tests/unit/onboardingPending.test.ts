// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {withTestQuestions} from "./onboardingTestQuestion"

import {
    EMPTY_ONBOARDING_DRAFT,
    onboardingDraftKey,
    readOnboardingDraft,
    saveOnboardingDraft,
} from "@/features/onboarding/onboardingDraft"
import {
    clearOnboardingPending,
    endOnboarding,
    isOnboardingPending,
    markOnboardingPending,
    resolvePendingOnboarding,
    type PendingOnboardingInput,
} from "@/features/onboarding/onboardingPending"

// Node's own `localStorage` global shadows jsdom's, so the test brings one.
beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
})

withTestQuestions()

describe("onboarding pending mark", () => {
    it("is written per user with its timestamp and cleared once", () => {
        markOnboardingPending("u1", 1700000000000)
        expect(window.localStorage.getItem("agenta:onboarding:pending:u1")).toBe("1700000000000")
        expect(isOnboardingPending("u1")).toBe(true)
        expect(isOnboardingPending("u2")).toBe(false)
        clearOnboardingPending("u1")
        expect(isOnboardingPending("u1")).toBe(false)
    })

    it("ends onboarding by clearing the user's mark and draft, and no one else's", () => {
        const saved = {...EMPTY_ONBOARDING_DRAFT, answers: {role: "Engineering"}}
        markOnboardingPending("u1")
        markOnboardingPending("u2")
        saveOnboardingDraft(onboardingDraftKey("u1"), saved)
        saveOnboardingDraft(onboardingDraftKey("u2"), saved)
        endOnboarding("u1")
        expect(isOnboardingPending("u1")).toBe(false)
        expect(readOnboardingDraft(onboardingDraftKey("u1"))).toEqual(EMPTY_ONBOARDING_DRAFT)
        expect(isOnboardingPending("u2")).toBe(true)
        expect(readOnboardingDraft(onboardingDraftKey("u2")).answers.role).toBe("Engineering")
    })
})

describe("what Home does about a pending mark", () => {
    const input = (overrides: Partial<PendingOnboardingInput> = {}): PendingOnboardingInput => ({
        enabled: true,
        pending: true,
        agentCount: 0,
        agentsPending: false,
        agentsError: false,
        ...overrides,
    })

    it("opens onboarding for a pending user in a settled empty project", () => {
        expect(resolvePendingOnboarding(input())).toBe("start")
    })

    it("holds Home while the user or the agent list is still loading", () => {
        expect(resolvePendingOnboarding(input({pending: null}))).toBe("wait")
        expect(resolvePendingOnboarding(input({agentsPending: true}))).toBe("wait")
    })

    it("dismisses the mark when the project already has agents, as for an invited teammate", () => {
        expect(resolvePendingOnboarding(input({agentCount: 2}))).toBe("dismiss")
        expect(resolvePendingOnboarding(input({agentCount: 2, agentsPending: true}))).toBe(
            "dismiss",
        )
    })

    it("leaves Home alone without a mark, with the flag off, or when the list failed", () => {
        expect(resolvePendingOnboarding(input({pending: false}))).toBe("none")
        expect(resolvePendingOnboarding(input({enabled: false}))).toBe("none")
        expect(resolvePendingOnboarding(input({enabled: false, pending: null}))).toBe("none")
        expect(resolvePendingOnboarding(input({agentsError: true}))).toBe("none")
    })
})
