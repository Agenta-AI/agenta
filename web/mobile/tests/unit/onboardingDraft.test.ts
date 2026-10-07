// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({
    templateBuilderMessage: (template: {name: string}) => `Build ${template.name}`,
}))

import {galleryTemplates} from "@/features/onboarding/onboardingChoices"
import {
    BLANK_AGENT,
    EMPTY_ONBOARDING_DRAFT,
    firstAgentInput,
    onboardingReducer,
    readOnboardingDraft,
    saveOnboardingDraft,
    type OnboardingDraft,
} from "@/features/onboarding/onboardingDraft"

type Template = Parameters<typeof galleryTemplates>[0][number]

const template = (key: string, category: string, name = key) =>
    ({
        key,
        name,
        category,
        color: "#123456",
        instructions: `${name} instructions`,
    }) as unknown as Template

afterEach(() => window.sessionStorage.clear())

const draft = (overrides: Partial<OnboardingDraft> = {}): OnboardingDraft => ({
    ...EMPTY_ONBOARDING_DRAFT,
    ...overrides,
})

describe("onboarding draft storage", () => {
    it("restores a saved draft and forgets it after creation", () => {
        const saved = draft({
            step: "creator",
            role: "Engineering",
            source: "GitHub",
            agent: {...BLANK_AGENT, name: "Atlas", apps: ["slack"]},
        })
        saveOnboardingDraft("draft", saved)
        expect(readOnboardingDraft("draft")).toEqual(saved)
        saveOnboardingDraft("draft", null)
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
    })

    it("starts over on malformed or incomplete stored drafts", () => {
        window.sessionStorage.setItem("draft", "{")
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
        window.sessionStorage.setItem("draft", JSON.stringify({step: "creator"}))
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
    })

    it("never resumes past an unanswered question or on a removed answer", () => {
        const atReferral = draft({step: "referral", role: "Engineering"})
        saveOnboardingDraft("draft", atReferral)
        expect(readOnboardingDraft("draft").step).toBe("referral")
        saveOnboardingDraft("draft", {...atReferral, step: "credits"})
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
        window.sessionStorage.setItem(
            "draft",
            JSON.stringify({...atReferral, role: "Removed role"}),
        )
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
    })
})

describe("onboarding answers", () => {
    it("resets the gallery to Recommended when the role changes, and only then", () => {
        const browsing = draft({role: "Engineering", category: "Sales", focus: "lead"})
        expect(onboardingReducer(browsing, {type: "role", role: "Sales"})).toEqual({
            ...browsing,
            role: "Sales",
            category: "recommended",
            focus: null,
        })
        expect(onboardingReducer(browsing, {type: "role", role: "Engineering"})).toBe(browsing)
    })

    it("fills the creator from a template and empties it for a blank start", () => {
        const filled = onboardingReducer(draft({agent: {...BLANK_AGENT, name: "Mine"}}), {
            type: "template",
            template: template("review", "Engineering", "PR reviewer"),
        })
        expect(filled.templateKey).toBe("review")
        expect(filled.agent).toEqual({
            name: "PR reviewer",
            icon: {icon: "code", color: "#123456"},
            instructions: "PR reviewer instructions",
            apps: [],
            firstMessage: "Build PR reviewer",
        })
        const blank = onboardingReducer(filled, {type: "scratch"})
        expect(blank.templateKey).toBeNull()
        expect(blank.agent).toEqual(BLANK_AGENT)
    })

    it("adds and removes an app once each", () => {
        const one = onboardingReducer(draft(), {type: "app", key: "slack", on: true})
        expect(onboardingReducer(one, {type: "app", key: "slack", on: true}).agent.apps).toEqual([
            "slack",
        ])
        expect(onboardingReducer(one, {type: "app", key: "slack", on: false}).agent.apps).toEqual(
            [],
        )
    })

    it("caps the name at 100 characters", () => {
        const long = onboardingReducer(draft(), {type: "agent", patch: {name: "x".repeat(150)}})
        expect(long.agent.name).toHaveLength(100)
    })
})

describe("first agent input", () => {
    it("needs instructions or a first message, and names a blank agent", () => {
        expect(firstAgentInput({...BLANK_AGENT, name: "Atlas"})).toBeNull()
        expect(firstAgentInput({...BLANK_AGENT, firstMessage: " Plan my week "})).toEqual({
            name: "My first agent",
            instructions: "",
            firstMessage: "Plan my week",
        })
        expect(
            firstAgentInput({...BLANK_AGENT, name: " Atlas ", instructions: " Be brief. "}),
        ).toEqual({name: "Atlas", instructions: "Be brief.", firstMessage: ""})
    })
})

describe("gallery templates", () => {
    const templates = [
        template("a", "Support"),
        template("b", "Ops"),
        ...Array.from({length: 6}, (_, index) => template(`e${index}`, "Engineering")),
    ]
    const keys = (list: Template[]) => list.map((item) => item.key)

    it("leads Recommended with the role's category and keeps six", () => {
        expect(keys(galleryTemplates(templates, "recommended", "Customer support"))).toEqual([
            "a",
            "b",
            "e0",
            "e1",
            "e2",
            "e3",
        ])
        expect(keys(galleryTemplates(templates, "recommended", "Finance"))[0]).toBe("b")
        expect(keys(galleryTemplates(templates, "recommended", null))).toHaveLength(6)
    })

    it("filters by category and lists everything under All", () => {
        expect(keys(galleryTemplates(templates, "Ops", "Engineering"))).toEqual(["b"])
        expect(galleryTemplates(templates, "all", "Engineering")).toHaveLength(8)
    })
})
