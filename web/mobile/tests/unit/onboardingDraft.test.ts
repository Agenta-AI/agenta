// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({
    templateBuilderMessage: (template: {name: string}) => `Build ${template.name}`,
    templateProviderSlugs: () => ["github", "slack"],
}))

import {galleryTemplates} from "@/features/onboarding/onboardingChoices"
import {
    BLANK_AGENT,
    blankAgentInput,
    EMPTY_ONBOARDING_DRAFT,
    onboardingDraftKey,
    onboardingReducer,
    readOnboardingDraft,
    saveOnboardingDraft,
    templateAgentInput,
    type OnboardingDraft,
} from "@/features/onboarding/onboardingDraft"
import {personProperties, recommendedCategory} from "@/features/onboarding/onboardingQuestions"

import {withTestQuestions} from "./onboardingTestQuestion"

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

withTestQuestions()

describe("onboarding draft storage", () => {
    it("restores a saved draft and forgets it after creation", () => {
        const saved = draft({
            answers: {persona: "Engineering", source: "GitHub"},
            agent: {...BLANK_AGENT, name: "Atlas", firstMessage: "Plan my week"},
            completed: ["persona", "source"],
        })
        saveOnboardingDraft("draft", saved)
        expect(readOnboardingDraft("draft")).toEqual(saved)
        saveOnboardingDraft("draft", null)
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
    })

    it("keys the draft by user, so a preview on any project resumes the same answers", () => {
        expect(onboardingDraftKey("user-1")).toBe("agenta:onboarding:draft:v4:user-1")
    })

    it("starts over on a malformed stored draft", () => {
        window.sessionStorage.setItem("draft", "{")
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
        window.sessionStorage.setItem("draft", JSON.stringify({step: "review"}))
        expect(readOnboardingDraft("draft")).toEqual(EMPTY_ONBOARDING_DRAFT)
    })

    it("drops answers, steps and fields the flow no longer has, and keeps the rest", () => {
        window.sessionStorage.setItem(
            "draft",
            JSON.stringify({
                ...draft({category: "Sales"}),
                templateKey: "pr-reviewer",
                answers: {persona: "Removed role", source: "GitHub", gone: "Yes"},
                completed: ["persona", "gone"],
            }),
        )
        expect(readOnboardingDraft("draft")).toEqual(
            draft({category: "Sales", answers: {source: "GitHub"}, completed: ["persona"]}),
        )
    })
})

describe("onboarding answers", () => {
    it("resets the gallery to Recommended when the role changes, and only then", () => {
        const browsing = draft({answers: {persona: "Engineering"}, category: "Sales"})
        expect(
            onboardingReducer(browsing, {type: "answer", question: "persona", value: "Sales"}),
        ).toEqual({...browsing, answers: {persona: "Sales"}, category: "recommended"})
        expect(
            onboardingReducer(browsing, {
                type: "answer",
                question: "persona",
                value: "Engineering",
            }),
        ).toBe(browsing)
        expect(
            onboardingReducer(browsing, {type: "answer", question: "source", value: "GitHub"}),
        ).toEqual({...browsing, answers: {persona: "Engineering", source: "GitHub"}})
    })

    it("sets only the answered questions as person properties", () => {
        expect(personProperties({persona: "Engineering"})).toEqual({user_role_v2: "Engineering"})
        expect(personProperties({persona: "Sales", source: "GitHub"})).toEqual({
            user_role_v2: "Sales",
            referral_source_v2: "GitHub",
        })
    })

    it("caps the name at 100 characters", () => {
        const long = onboardingReducer(draft(), {type: "agent", patch: {name: "x".repeat(150)}})
        expect(long.agent.name).toHaveLength(100)
    })
})

describe("first agent input", () => {
    it("needs a first message on a blank start, and names it", () => {
        const agent = {...BLANK_AGENT, name: " Atlas "}
        expect(blankAgentInput(agent, "  ")).toBeNull()
        expect(blankAgentInput(BLANK_AGENT, " Plan my week ")).toEqual({
            name: "My first agent",
            firstMessage: "Plan my week",
            templateKey: null,
            icon: BLANK_AGENT.icon,
            apps: [],
        })
        expect(blankAgentInput(agent, "Hi")?.name).toBe("Atlas")
    })

    it("creates a template from its package, look and connected apps", () => {
        const connected = new Map([["slack", "Slack"]])
        expect(
            templateAgentInput(template("review", "Engineering", "PR reviewer"), connected),
        ).toEqual({
            name: "PR reviewer",
            firstMessage: "",
            templateKey: "review",
            icon: {icon: "code", color: "#123456"},
            apps: ["slack"],
        })
    })
})

describe("gallery templates", () => {
    const templates = [
        template("a", "Support"),
        template("b", "Ops"),
        ...Array.from({length: 6}, (_, index) => template(`e${index}`, "Engineering")),
    ]
    const keys = (list: Template[]) => list.map((item) => item.key)

    const recommended = (role?: string) =>
        keys(galleryTemplates(templates, "recommended", recommendedCategory({persona: role})))

    it("leads Recommended with the role's category and keeps six", () => {
        expect(recommended("Engineering")).toEqual(["e0", "e1", "e2", "e3", "e4", "e5"])
        expect(recommended("Finance")).toEqual(["b", "a", "e0", "e1", "e2", "e3"])
        expect(recommended()).toEqual(["a", "b", "e0", "e1", "e2", "e3"])
    })

    it("filters by category and lists everything under All", () => {
        expect(keys(galleryTemplates(templates, "Ops", "Engineering"))).toEqual(["b"])
        expect(galleryTemplates(templates, "all", "Engineering")).toHaveLength(8)
    })
})
