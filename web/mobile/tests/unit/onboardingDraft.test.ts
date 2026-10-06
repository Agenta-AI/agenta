// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({
    templateBuilderMessage: (template: {name: string}) => `Build ${template.name}`,
}))

import {firstAgentInput, suggestionsForRole} from "@/features/onboarding/onboardingChoices"
import {
    activeOnboardingSteps,
    canLeaveStep,
    EMPTY_ONBOARDING_DRAFT,
    onboardingReducer,
    readOnboardingDraft,
    saveOnboardingDraft,
    stepAfter,
    type OnboardingDraft,
} from "@/features/onboarding/onboardingDraft"

type Template = Parameters<typeof firstAgentInput>[2] & object

const template = (key: string, category: string, name = key) =>
    ({key, name, category}) as unknown as Template

afterEach(() => window.sessionStorage.clear())

const draft = (overrides: Partial<OnboardingDraft> = {}): OnboardingDraft => ({
    ...EMPTY_ONBOARDING_DRAFT,
    ...overrides,
})

describe("onboarding draft storage", () => {
    it("restores a saved draft and forgets it after creation", () => {
        const saved = draft({step: "model", role: "Engineering"})
        saveOnboardingDraft("draft", saved)
        expect(readOnboardingDraft("draft")).toEqual(saved)
        saveOnboardingDraft("draft", null)
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
    })

    it("starts over on malformed or incomplete stored drafts", () => {
        window.sessionStorage.setItem("draft", "{")
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
        window.sessionStorage.setItem("draft", JSON.stringify({step: "agent"}))
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
    })

    it("keeps an unanswered referral until its step and rejects removed answers", () => {
        const atReferral = draft({step: "referral", role: "Engineering"})
        saveOnboardingDraft("draft", atReferral)
        expect(readOnboardingDraft("draft").step).toBe("referral")
        saveOnboardingDraft("draft", {...atReferral, step: "agent"})
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
        window.sessionStorage.setItem(
            "draft",
            JSON.stringify({...atReferral, role: "Removed role"}),
        )
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
    })
})

describe("onboarding answers", () => {
    it("drops the pick, task, name and icon when the role changes", () => {
        const picked = draft({
            role: "Engineering",
            name: "Reviewer",
            task: "Do it",
            pick: {kind: "template", key: "review"},
            icon: {icon: "bug", color: "#111111"},
        })
        expect(onboardingReducer(picked, {type: "role", role: "Sales"})).toEqual({
            ...picked,
            role: "Sales",
            name: "",
            task: "",
            pick: null,
            icon: null,
        })
    })

    it("keeps every answer when the same role is picked again", () => {
        const picked = draft({role: "Engineering", name: "Reviewer"})
        expect(onboardingReducer(picked, {type: "role", role: "Engineering"})).toBe(picked)
    })

    it("names the agent after a picked template only in name-first", () => {
        const pr = template("review", "Engineering", "PR reviewer")
        const control = onboardingReducer(draft({name: "Mine"}), {
            type: "template",
            template: pr,
            index: 0,
            variant: "control",
        })
        expect(control.name).toBe("PR reviewer")
        expect(control.icon).toEqual({icon: "git-pull-request", color: expect.any(String)})
        const taskFirst = onboardingReducer(draft({name: "Mine"}), {
            type: "template",
            template: pr,
            index: 1,
            variant: "task-first",
        })
        expect(taskFirst.name).toBe("Mine")
        expect(taskFirst.icon?.icon).toBe("bug")
    })

    it("gates each step on its own answer", () => {
        expect(canLeaveStep(draft(), {modelReady: true})).toBe(false)
        expect(canLeaveStep(draft({role: "Product"}), {modelReady: false})).toBe(true)
        expect(canLeaveStep(draft({role: "Product", step: "model"}), {modelReady: false})).toBe(
            false,
        )
        expect(canLeaveStep(draft({role: "Product", step: "referral"}), {modelReady: true})).toBe(
            false,
        )
    })

    it("skips the tools step when the deployment has no tool gateway", () => {
        expect(activeOnboardingSteps(false)).toEqual(["role", "model", "referral", "agent"])
        expect(stepAfter(activeOnboardingSteps(true), "role")).toBe("tools")
        expect(stepAfter(activeOnboardingSteps(true), "agent")).toBeNull()
    })
})

describe("first agent input", () => {
    it("rejects blank input and trims custom tasks", () => {
        expect(firstAgentInput("control", {name: " ", task: "do this"}, null)).toBeNull()
        expect(firstAgentInput("task-first", {name: "", task: "  "}, null)).toBeNull()
        expect(firstAgentInput("task-first", {name: "", task: " Plan my week "}, null)).toEqual({
            name: "My first agent",
            seedMessage: "Plan my week",
        })
    })

    it("seeds a name alone with a builder prompt and a template with its builder message", () => {
        expect(firstAgentInput("control", {name: " Atlas ", task: ""}, null)).toEqual({
            name: "Atlas",
            seedMessage: "Set up Atlas: help me define what this agent should do.",
        })
        expect(
            firstAgentInput("task-first", {name: "", task: ""}, template("r", "x", "PR reviewer")),
        ).toEqual({name: "PR reviewer", seedMessage: "Build PR reviewer"})
    })

    it("suggests at most five templates from the role's category", () => {
        const templates = [
            template("a", "Support"),
            template("b", "Ops"),
            ...Array.from({length: 6}, (_, index) => template(`e${index}`, "Engineering")),
        ]
        expect(suggestionsForRole(templates, "Customer support").map((item) => item.key)).toEqual([
            "a",
        ])
        expect(suggestionsForRole(templates, "Engineering")).toHaveLength(5)
        expect(suggestionsForRole(templates, null)).toEqual([])
    })
})
