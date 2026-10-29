// @vitest-environment jsdom
import {AGENT_ICON_COLORS} from "@agenta/ui/agent-icon"
import {afterEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({
    templateBuilderMessage: (template: {name: string}) => `Build ${template.name}`,
    templateProviderSlugs: () => ["github", "slack"],
}))

import {galleryTemplates, ICON_CHOICES} from "@/features/onboarding/onboardingChoices"
import {
    BLANK_AGENT,
    blankAgentInput,
    EMPTY_ONBOARDING_DRAFT,
    onboardingDraftKey,
    onboardingReducer,
    randomAgentIcon,
    readOnboardingDraft,
    saveOnboardingDraft,
    templateAgentInput,
    type OnboardingDraft,
} from "@/features/onboarding/onboardingDraft"
import {
    personProperties,
    recommendedCategory,
    type OnboardingQuestionId,
} from "@/features/onboarding/onboardingQuestions"

import {
    GOALS_QUESTION,
    registerQuestion,
    withTestQuestions,
    WORK_STYLE_QUESTION,
} from "./onboardingTestQuestion"

const GOALS = GOALS_QUESTION.id as OnboardingQuestionId
const WORK_STYLE = WORK_STYLE_QUESTION.id as OnboardingQuestionId

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

    it("stores a multi-select answer as a list and clears it when every chip is off", () => {
        registerQuestion(GOALS_QUESTION)
        const picked = onboardingReducer(draft(), {
            type: "answer",
            question: GOALS,
            value: ["Support", "Coding"],
        })
        expect(picked.answers).toEqual({goals: ["Support", "Coding"]})
        expect(
            onboardingReducer(picked, {
                type: "answer",
                question: GOALS,
                value: ["Support", "Coding"],
            }),
        ).toBe(picked)
        expect(
            onboardingReducer(picked, {type: "answer", question: GOALS, value: []}).answers,
        ).toEqual({})
        expect(recommendedCategory({goals: ["Research", "Support"]})).toBe("Support")
        expect(personProperties({goals: ["Coding", "Research"]})).toEqual({
            agent_goals_v1: ["Coding", "Research"],
        })
    })

    it("leaves a write-in question unanswered when its line is cleared, and restores none", () => {
        registerQuestion(WORK_STYLE_QUESTION)
        const written = onboardingReducer(draft(), {
            type: "answer",
            question: WORK_STYLE,
            value: "Other: A home server",
        })
        expect(written.answers).toEqual({workStyle: "Other: A home server"})
        const cleared = onboardingReducer(written, {
            type: "answer",
            question: WORK_STYLE,
            value: [],
        })
        expect(cleared.answers).toEqual({})
        // A bare label is not an answer to a write-in choice, so a reload does not restore it.
        saveOnboardingDraft("onboarding:test", draft({answers: {workStyle: "Other: "}}))
        expect(readOnboardingDraft("onboarding:test").answers).toEqual({})
    })

    it("fits a stored answer to its question's shape and choices", () => {
        registerQuestion(GOALS_QUESTION)
        window.sessionStorage.setItem(
            "draft",
            JSON.stringify({
                ...draft(),
                answers: {
                    goals: ["Gone", "Coding"],
                    persona: ["Sales", "Engineering"],
                    source: "Gone",
                },
            }),
        )
        expect(readOnboardingDraft("draft").answers).toEqual({
            goals: ["Coding"],
            persona: "Sales",
        })
        window.sessionStorage.setItem(
            "draft",
            JSON.stringify({...draft(), answers: {goals: "Research"}}),
        )
        expect(readOnboardingDraft("draft").answers).toEqual({goals: ["Research"]})
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
    it("needs a first message on a blank start, leaves the name to the agent, draws a look", () => {
        const look = {icon: "globe", color: "#123456"}
        expect(blankAgentInput("  ", () => look)).toBeNull()
        expect(blankAgentInput(" Plan my week ", () => look)).toEqual({
            name: "",
            firstMessage: "Plan my week",
            templateKey: null,
            icon: look,
            apps: [],
        })
    })

    it("draws a random look from the offered glyphs and swatches", () => {
        expect(randomAgentIcon(() => 0)).toEqual({
            icon: ICON_CHOICES[0],
            color: AGENT_ICON_COLORS[0][0],
        })
        const last = randomAgentIcon(() => 0.9999)
        expect(last.icon).toBe(ICON_CHOICES[ICON_CHOICES.length - 1])
        expect(last.color).toBe(AGENT_ICON_COLORS[AGENT_ICON_COLORS.length - 1][0])
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
