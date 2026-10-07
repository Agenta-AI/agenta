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
    onboardingDraftKey,
    onboardingReducer,
    readOnboardingDraft,
    saveOnboardingDraft,
    type OnboardingDraft,
} from "@/features/onboarding/onboardingDraft"
import {personProperties, recommendedCategory} from "@/features/onboarding/onboardingQuestions"

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
            answers: {role: "Engineering", source: "GitHub"},
            templateKey: "review",
            agent: {...BLANK_AGENT, name: "Atlas", apps: ["slack"]},
            completed: ["role", "source"],
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

    it("drops answers and steps the questions no longer have, and keeps the rest", () => {
        window.sessionStorage.setItem(
            "draft",
            JSON.stringify({
                ...draft({templateKey: "review"}),
                answers: {role: "Removed role", source: "GitHub", gone: "Yes"},
                completed: ["role", "gone"],
            }),
        )
        expect(readOnboardingDraft("draft")).toEqual(
            draft({templateKey: "review", answers: {source: "GitHub"}, completed: ["role"]}),
        )
    })
})

describe("onboarding answers", () => {
    it("resets the gallery to Recommended when the role changes, and only then", () => {
        const browsing = draft({answers: {role: "Engineering"}, category: "Sales"})
        expect(
            onboardingReducer(browsing, {type: "answer", question: "role", value: "Sales"}),
        ).toEqual({...browsing, answers: {role: "Sales"}, category: "recommended"})
        expect(
            onboardingReducer(browsing, {type: "answer", question: "role", value: "Engineering"}),
        ).toBe(browsing)
        expect(
            onboardingReducer(browsing, {type: "answer", question: "source", value: "GitHub"}),
        ).toEqual({...browsing, answers: {role: "Engineering", source: "GitHub"}})
    })

    it("sets only the answered questions as person properties", () => {
        expect(personProperties({role: "Engineering"})).toEqual({user_role_v2: "Engineering"})
        expect(personProperties({role: "Sales", source: "GitHub"})).toEqual({
            user_role_v2: "Sales",
            referral_source_v2: "GitHub",
        })
    })

    it("fills the creator from a template and empties it for a blank start", () => {
        const filled = onboardingReducer(draft({agent: {...BLANK_AGENT, name: "Mine"}}), {
            type: "template",
            template: template("review", "Engineering", "PR reviewer"),
            apps: ["github"],
        })
        expect(filled.templateKey).toBe("review")
        expect(filled.agent).toEqual({
            name: "PR reviewer",
            icon: {icon: "code", color: "#123456"},
            apps: ["github"],
            firstMessage: "",
        })
        const blank = onboardingReducer(filled, {type: "scratch"})
        expect(blank.templateKey).toBeNull()
        expect(blank.agent).toEqual(BLANK_AGENT)
    })

    it("keeps edits when the same template or a blank start is picked again", () => {
        const pr = template("review", "Engineering", "PR reviewer")
        const edited = onboardingReducer(
            onboardingReducer(draft(), {type: "template", template: pr, apps: []}),
            {type: "agent", patch: {name: "Mine"}},
        )
        expect(onboardingReducer(edited, {type: "template", template: pr, apps: []})).toBe(edited)
        const blank = onboardingReducer(draft(), {type: "agent", patch: {name: "Blank"}})
        expect(onboardingReducer(blank, {type: "scratch"}).agent.name).toBe("Blank")
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
    it("needs a first message on a blank start, and names it", () => {
        const blank = (agent: Partial<typeof BLANK_AGENT>) => ({
            templateKey: null,
            agent: {...BLANK_AGENT, ...agent},
        })
        expect(firstAgentInput(blank({name: "Atlas"}), null)).toBeNull()
        expect(firstAgentInput(blank({firstMessage: " Plan my week "}), null)).toEqual({
            name: "My first agent",
            firstMessage: "Plan my week",
            templateKey: null,
        })
        expect(firstAgentInput(blank({name: " Atlas ", firstMessage: "Hi"}), null)).toEqual({
            name: "Atlas",
            firstMessage: "Hi",
            templateKey: null,
        })
    })

    it("creates a template from its own name once the catalog has it", () => {
        const picked = {templateKey: "review", agent: {...BLANK_AGENT, name: "Edited"}}
        expect(firstAgentInput(picked, null)).toBeNull()
        expect(firstAgentInput(picked, template("review", "Engineering", "PR reviewer"))).toEqual({
            name: "PR reviewer",
            firstMessage: "",
            templateKey: "review",
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
        keys(galleryTemplates(templates, "recommended", recommendedCategory({role})))

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
